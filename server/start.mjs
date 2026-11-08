import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,extname} from 'node:path';
import {Readable} from 'node:stream';
import {createApp} from './app.mjs';
const port=Number(process.env.PORT||3000),origin=process.env.APP_ORIGIN||`http://127.0.0.1:${port}`;
const databasePath=resolve(process.env.DATA_FILE||'private-data/capstone.sqlite');await mkdir(dirname(databasePath),{recursive:true,mode:0o700});
const app=await createApp({origin,databasePath,adminEmail:process.env.ADMIN_EMAIL,adminPassword:process.env.ADMIN_PASSWORD});
const root=fileURLToPath(new URL('../collaboration/',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,origin);
 if(url.pathname.startsWith('/api/')){
  const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
  const response=await app.handle(request,{ip:req.socket.remoteAddress});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
 }
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
 if(url.pathname==='/'){res.writeHead(302,{location:'/collaboration/'});res.end();return;}
 const path=url.pathname.replace(/^\/collaboration\//,'');
 if(path==='runtime-config.js'){res.writeHead(200,{'content-type':mime['.js'],'cache-control':'no-store'});res.end("window.CAPSTONE_CONFIG=Object.freeze({mode:'server'});");return;}
 const allowed=/^(index\.html|app\.mjs|design\.css|integration\.css|modules\/[a-z-]+\.mjs)$/;
 const name=path===''?'index.html':path;if(!url.pathname.startsWith('/collaboration/')||!allowed.test(name)){res.writeHead(404);res.end();return;}
 const data=await readFile(resolve(root,name));res.writeHead(200,{'content-type':mime[extname(name)],'x-content-type-options':'nosniff','cache-control':'no-cache','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"});res.end(req.method==='HEAD'?undefined:data);
 }catch{res.writeHead(500);res.end('Server error');}});
server.listen(port,'127.0.0.1',()=>console.log(`Capstone server ready on ${origin}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{app.close();process.exit(0);}));
