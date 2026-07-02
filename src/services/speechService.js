export const getVoices=()=>window.speechSynthesis?.getVoices()||[];
export const createUtterance=(text,{voice,rate,pitch=1,onBoundary,onEnd,onError})=>{const u=new SpeechSynthesisUtterance(text);u.voice=voice||null;u.lang=voice?.lang||'bg-BG';u.rate=Math.max(.65,Math.min(1.55,rate));u.pitch=pitch;u.volume=1;u.onboundary=onBoundary;u.onend=onEnd;u.onerror=onError;return u;};
// Future providers can implement the same play/pause/stop contract here.
export const ttsProviders={browser:{id:'browser',label:'Глас от устройството',requiresKey:false},openai:{id:'openai',label:'OpenAI TTS',requiresKey:true},elevenlabs:{id:'elevenlabs',label:'ElevenLabs',requiresKey:true}};
