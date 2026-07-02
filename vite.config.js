import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({plugins:[react(),VitePWA({registerType:'autoUpdate',includeAssets:['icon.svg'],manifest:{name:'Voxora AI Reader',short_name:'Voxora',description:'Слушай своя текст с избран глас и атмосфера.',theme_color:'#102a2a',background_color:'#f4f2e9',display:'standalone',start_url:'/',icons:[{src:'/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any maskable'}]}})]});
