const themes={
 relax:{wave:'sine',notes:[174.61,220,261.63],pulse:0,detune:0},
 focus:{wave:'triangle',notes:[220,277.18,329.63,440],pulse:900,detune:0},
 classical:{wave:'sine',notes:[261.63,329.63,392,523.25],pulse:650,detune:0},
 ambient:{wave:'sine',notes:[130.81,196,293.66],pulse:0,detune:9},
 meditative:{wave:'sine',notes:[110,164.81,220],pulse:2400,detune:0},
 cinematic:{wave:'sawtooth',notes:[82.41,123.47,164.81,246.94],pulse:1200,detune:0},
};

export class AmbientAudio{
 constructor(){this.ctx=null;this.gain=null;this.nodes=[];this.timers=[];this.genre='relax';this.volume=.24}
 tone(freq,wave,level=.08,detune=0){const osc=this.ctx.createOscillator(),gain=this.ctx.createGain();osc.type=wave;osc.frequency.value=freq;osc.detune.value=detune;gain.gain.value=level;osc.connect(gain).connect(this.gain);osc.start();this.nodes.push(osc);return gain}
 start(genre=this.genre){this.stop();this.genre=genre;const theme=themes[genre]||themes.relax;this.ctx=new(window.AudioContext||window.webkitAudioContext)();this.gain=this.ctx.createGain();this.gain.gain.value=this.volume;this.gain.connect(this.ctx.destination);
  if(genre==='relax'){theme.notes.forEach((n,i)=>{const g=this.tone(n,theme.wave,.08/(i+1));const lfo=this.ctx.createOscillator(),depth=this.ctx.createGain();lfo.frequency.value=.08+i*.025;depth.gain.value=.025;lfo.connect(depth).connect(g.gain);lfo.start();this.nodes.push(lfo)})}
  else if(genre==='ambient'){theme.notes.forEach((n,i)=>{this.tone(n,'sine',.065/(i+1),-theme.detune);this.tone(n,'sine',.065/(i+1),theme.detune)})}
  else {const playStep=()=>{const i=Math.floor((this.ctx.currentTime*1000/theme.pulse))%theme.notes.length;const g=this.tone(theme.notes[i],theme.wave,genre==='cinematic'?.055:.11);const now=this.ctx.currentTime;g.gain.setValueAtTime(genre==='meditative'?.14:.1,now);g.gain.exponentialRampToValueAtTime(.001,now+(genre==='meditative'?2.1:.55))};playStep();this.timers.push(setInterval(playStep,theme.pulse))}
  this.ctx.resume()
 }
 setVolume(v){this.volume=v;if(this.gain)this.gain.gain.setTargetAtTime(v,this.ctx.currentTime,.08)}
 pause(){this.ctx?.suspend()}resume(){this.ctx?.resume()}
 stop(){this.timers.forEach(clearInterval);this.timers=[];this.nodes.forEach(n=>{try{n.stop()}catch{}});this.nodes=[];this.ctx?.close();this.ctx=null;this.gain=null}
}
