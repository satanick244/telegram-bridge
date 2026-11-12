import {defineConfig} from 'vite';
export default defineConfig({server:{host:'0.0.0.0',port:3000,proxy:{'/api':{target:process.env.JAVA_API_URL||'http://127.0.0.1:8080',changeOrigin:false}}}});
