const READ_SIZE = 256 * 1024;
const MAX_READS = 512;

const timeValue = (value, milliseconds = false) => {
  if (typeof value === 'string' && value.includes(':')) {
    const parts = value.split(':').map(Number);
    if (parts.every(Number.isFinite)) {
      return parts.reduce((total, part) => total * 60 + part, 0);
    }
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return milliseconds ? numeric / 1000 : numeric;
};

export const normalizeAudioChapters = (input, duration = 0) => {
  const source = Array.isArray(input)
    ? input
    : Array.isArray(input?.chapters) ? input.chapters : [];

  const chapters = source.map((chapter, index) => {
    const regularStart = chapter.start ?? chapter.startTime ?? chapter.time ?? chapter.offset;
    const regularEnd = chapter.end ?? chapter.endTime;
    const start = regularStart !== undefined
      ? timeValue(regularStart)
      : timeValue(chapter.start_ms ?? chapter.startMs, true);
    const end = regularEnd !== undefined
      ? timeValue(regularEnd)
      : timeValue(chapter.end_ms ?? chapter.endMs, true);
    return {
      title: String(chapter.title || chapter.name || chapter.label || `Глава ${index + 1}`).trim(),
      start,
      end,
    };
  }).filter((chapter) => chapter.start !== null);

  chapters.sort((a, b) => a.start - b.start);
  return chapters.map((chapter, index) => ({
    title: chapter.title || `Глава ${index + 1}`,
    start: chapter.start,
    end: chapter.end && chapter.end > chapter.start
      ? chapter.end
      : chapters[index + 1]?.start || duration || 0,
  }));
};

export const parseNeroChapterBox = (data, duration = 0) => {
  if (!(data instanceof Uint8Array) || data.length < 9) return [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = data[8];
  const decoder = new globalThis.TextDecoder('utf-8');
  const chapters = [];
  let offset = 9;

  for (let index = 0; index < count && offset + 9 <= data.length; index += 1) {
    const high = view.getUint32(offset);
    const low = view.getUint32(offset + 4);
    const ticks = high * 4294967296 + low;
    offset += 8;
    const titleLength = data[offset];
    offset += 1;
    if (offset + titleLength > data.length) break;
    chapters.push({
      title: decoder.decode(data.subarray(offset, offset + titleLength)) || `Глава ${index + 1}`,
      start: ticks / 10000000,
    });
    offset += titleLength;
  }
  return normalizeAudioChapters(chapters, duration);
};

const chapterTitleFromSample = (data, index) => {
  if (!data?.length) return `Глава ${index + 1}`;
  const length = data.length >= 2 ? (data[0] << 8) | data[1] : 0;
  const titleBytes = length > 0 && length + 2 <= data.length
    ? data.subarray(2, 2 + length)
    : data;
  return new globalThis.TextDecoder('utf-8').decode(titleBytes).replace(/\0/g, '').trim()
    || `Глава ${index + 1}`;
};

const fourCC = (value) => String.fromCodePoint(
  (value >>> 24) & 255,
  (value >>> 16) & 255,
  (value >>> 8) & 255,
  value & 255,
);

const metadataValue = (list, names) => {
  for (const [key, box] of Object.entries(list || {})) {
    if (names.includes(fourCC(Number(key))) && typeof box?.value === 'string') {
      const value = box.value.trim();
      if (value) return value;
    }
  }
  return '';
};

export const metadataFromIlst = (ilst, info = {}) => {
  const list = ilst?.list || {};
  const author = metadataValue(list, ['aART', '©ART', '©wrt']);
  const narrator = metadataValue(list, ['©nrt', 'narr']);
  const coverBox = Object.entries(list)
    .find(([key]) => fourCC(Number(key)) === 'covr')?.[1];
  const coverBytes = coverBox?.raw instanceof Uint8Array ? coverBox.raw : null;
  const coverType = coverBox?.valueType === 14 || coverBytes?.[0] === 0x89
    ? 'image/png'
    : 'image/jpeg';

  return {
    metadata: {
      title: metadataValue(list, ['©nam']),
      authors: author ? [author] : [],
      narrators: narrator ? [narrator] : [],
      series: metadataValue(list, ['©alb']),
      genre: metadataValue(list, ['©gen']),
      year: metadataValue(list, ['©day']),
      description: metadataValue(list, ['desc', 'ldes', '©cmt']),
      copyright: metadataValue(list, ['cprt', '©cpy']),
      duration: info.duration && info.timescale ? info.duration / info.timescale : 0,
      codec: info.audioTracks?.[0]?.codec || '',
    },
    cover: coverBytes?.length ? new Blob([coverBytes], { type: coverType }) : null,
  };
};

const blobSource = (blob) => ({
  size: blob.size,
  read: (start, end) => blob.slice(start, end).arrayBuffer(),
});

const remoteSource = async (url) => {
  const probe = await fetch(url, { headers: { Range: 'bytes=0-0' } });
  if (probe.status !== 206) {
    await probe.body?.cancel?.();
    throw new Error('Източникът не поддържа Range заявки за главите.');
  }
  const match = probe.headers.get('content-range')?.match(/\/(\d+)$/);
  await probe.body?.cancel?.();
  const size = Number(match?.[1]);
  if (!Number.isFinite(size) || size <= 0) throw new Error('Размерът на M4B файла не е известен.');

  return {
    size,
    read: async (start, end) => {
      const response = await fetch(url, {
        headers: { Range: `bytes=${start}-${Math.max(start, end - 1)}` },
      });
      if (response.status !== 206) throw new Error('M4B Range заявката беше отказана.');
      return response.arrayBuffer();
    },
  };
};

const parseSource = async (source) => {
  const MP4Box = await import('mp4box');
  const file = MP4Box.createFile();
  let result = null;
  let expectedSamples = 0;
  let extractedSamples = [];

  file.onError = () => {
    result = { chapters: [], metadata: {}, cover: null };
  };
  file.onReady = (info) => {
    const embedded = metadataFromIlst(file.moov?.udta?.meta?.ilst, info);
    const finish = (chapters) => {
      result = { chapters, ...embedded };
    };
    const nero = file.moov?.udta?.chpl?.data;
    if (nero) {
      finish(parseNeroChapterBox(nero, info.duration / info.timescale));
      return;
    }

    const chapterReference = info.audioTracks
      ?.flatMap((track) => track.references || [])
      .find((reference) => reference.type === 'chap');
    const chapterTrackId = chapterReference?.track_ids?.[0];
    const chapterTrack = info.tracks?.find((track) => track.id === chapterTrackId);
    if (!chapterTrackId || !chapterTrack) {
      finish([]);
      return;
    }

    expectedSamples = chapterTrack.nb_samples || 0;
    file.onSamples = (trackId, _user, samples) => {
      if (trackId !== chapterTrackId) return;
      extractedSamples = extractedSamples.concat(samples);
      if (!expectedSamples || extractedSamples.length >= expectedSamples) {
        finish(normalizeAudioChapters(extractedSamples.map((sample, index) => ({
          title: chapterTitleFromSample(sample.data, index),
          start: sample.cts / sample.timescale,
          end: (sample.cts + sample.duration) / sample.timescale,
        })), info.duration / info.timescale));
      }
    };
    file.setExtractionOptions(chapterTrackId, null, {
      nbSamples: Math.max(1, expectedSamples),
      rapAlignment: false,
    });
    file.start();
  };

  let offset = 0;
  const visits = new Map();
  for (let readCount = 0; result === null && readCount < MAX_READS; readCount += 1) {
    if (offset < 0 || offset >= source.size) break;
    const repeats = visits.get(offset) || 0;
    if (repeats > 2) break;
    visits.set(offset, repeats + 1);

    const end = Math.min(source.size, offset + READ_SIZE);
    const buffer = await source.read(offset, end);
    buffer.fileStart = offset;
    const requestedOffset = file.appendBuffer(buffer);
    offset = Number.isFinite(requestedOffset) && requestedOffset !== offset
      ? requestedOffset
      : end;
  }
  file.flush();
  return result || { chapters: [], metadata: {}, cover: null };
};

const mergeMetadata = (embedded = {}, provided = {}) => ({
  ...embedded,
  ...provided,
  authors: provided.authors?.length ? provided.authors : embedded.authors || [],
  narrators: provided.narrators?.length ? provided.narrators : embedded.narrators || [],
});

export const loadM4bDetails = async ({
  file,
  url,
  metadata,
  savedChapters,
  duration = 0,
}) => {
  const known = normalizeAudioChapters(
    savedChapters?.length ? savedChapters : metadata?.chapters || metadata?.chapterMarkers,
    duration,
  );
  try {
    const source = file instanceof Blob ? blobSource(file) : await remoteSource(url);
    const embedded = await parseSource(source);
    return {
      chapters: known.length ? known : embedded.chapters,
      metadata: mergeMetadata(embedded.metadata, metadata),
      cover: embedded.cover,
    };
  } catch {
    return { chapters: known, metadata: metadata || {}, cover: null };
  }
};

export const loadM4bChapters = async (options) => (
  await loadM4bDetails(options)
).chapters;
