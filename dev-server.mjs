import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root=process.cwd();
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    let file=normalize(join(root,pathname==='/'?'index.html':pathname.slice(1)));
    if(!file.startsWith(root)){res.writeHead(403);res.end('Forbidden');return;}
    if((await stat(file)).isDirectory())file=join(file,'index.html');
    const body=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);
  }catch(error){res.writeHead(404);res.end('Not found');}
}).listen(4173,'127.0.0.1',()=>console.log('BMS Stock Count: http://localhost:4173'));
