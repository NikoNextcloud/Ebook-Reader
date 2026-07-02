import {defineConfig,loadEnv} from 'vite';
import react from '@vitejs/plugin-react';
import {VitePWA} from 'vite-plugin-pwa';
export default defineConfig(({mode})=>{const env=loadEnv(mode,'.','');const geminiKey=env.GEMINI_API_KEY||env.VITE_GEMINI_API_KEY||'';return{plugins:[react(),VitePWA({registerType:'autoUpdate',includeAssets:['icon.svg'],manifest:{name:'Voxora AI Reader',short_name:'Voxora',description:'Слушай своя текст с избран AI глас и атмосфера.',theme_color:'#102a2a',background_color:'#f4f2e9',display:'standalone',start_url:'/',icons:[{src:'/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any maskable'}]}})],define:{__GEMINI_API_KEY__:JSON.stringify(geminiKey),'process.env.API_KEY':JSON.stringify(geminiKey),'process.env.GEMINI_API_KEY':JSON.stringify(geminiKey)}}});
