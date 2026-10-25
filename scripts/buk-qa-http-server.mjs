// Built-in-only HTTP transport shared by local QA and the downloadable preview.
import { createServer } from 'node:http';

export function startBukQaHttpServer({js,css,initialDocuments=[],realtimeQa=false,restrictConnections=false,extraHoursTemplate,port=5173,host='127.0.0.1'}) {
const savedDocuments=new Map(initialDocuments);
const eventClients=new Set();
const qaControl={readErrors:[],rejectApprovals:false};
let nextRequestId=1;
const publish=path=>{if(realtimeQa)for(const client of eventClients)client.write('data: '+JSON.stringify({path})+'\n\n')};
const server=createServer(async(req,res)=>{
 if (restrictConnections) res.setHeader('Content-Security-Policy',"connect-src 'self'; object-src 'none'; base-uri 'self'");
 if(req.url==='/qa-events'){
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});
  res.write(': connected\n\n');eventClients.add(res);req.on('close',()=>eventClients.delete(res));
 }
 else if(req.url==='/qa-control'&&req.method==='POST'){
  let body='';for await(const chunk of req)body+=chunk;Object.assign(qaControl,JSON.parse(body));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true}));
 }
 else if(req.url.startsWith('/qa-collection')){
  const path=new URL(req.url,'http://qa.local').searchParams.get('path');
  res.setHeader('Content-Type','application/json');
  if(qaControl.readErrors.includes(path)){res.statusCode=503;res.end(JSON.stringify({error:'Fallo de colección aislado'}));return}
  res.end(JSON.stringify([...savedDocuments].filter(([key,data])=>key.startsWith(path+'/')&&data!=null).map(([key,data])=>({id:key.slice(path.length+1),data}))));
 }
 else if(req.url==='/qa-add'&&req.method==='POST'){
  let body='';for await(const chunk of req)body+=chunk;const {path,data}=JSON.parse(body);
  res.setHeader('Content-Type','application/json');
  if(path!=='schedule_requests'){res.statusCode=400;res.end(JSON.stringify({error:'Colección no permitida en la prueba'}));return}
  const id=nextRequestId++,key=path+'/'+id;savedDocuments.set(key,data);res.end(JSON.stringify({id}));publish(key);
 }
 else if(req.url==='/qa-approval'&&req.method==='POST'){
  let body='';for await(const chunk of req)body+=chunk;const {table,patch,filters}=JSON.parse(body);
  res.setHeader('Content-Type','application/json');
  if(qaControl.rejectApprovals&&patch.status==='approved'){res.end(JSON.stringify({data:null,error:{message:'Conflicto con el horario de estudios actualizado.'}}));return}
  const key=table+'/'+filters.id,prior=savedDocuments.get(key);
  if(!prior||prior.status!==filters.status){res.end(JSON.stringify({data:null,error:null}));return}
  savedDocuments.set(key,{...prior,...patch});res.end(JSON.stringify({data:{id:filters.id,status:patch.status},error:null}));publish(key);
 }
 else if(req.url.startsWith('/qa-document')){
  res.setHeader('Content-Type','application/json');
  if(req.method==='POST'){
   let body='';for await(const chunk of req)body+=chunk;
   const {path,data}=JSON.parse(body);savedDocuments.set(path,data);res.end(JSON.stringify({saved:true}));
   publish(path);
  }else{
   const path=new URL(req.url,'http://qa.local').searchParams.get('path');
   if(qaControl.readErrors.includes(path)){res.statusCode=503;res.end(JSON.stringify({error:'Fallo de lectura aislado'}));return}
   res.end(JSON.stringify({found:savedDocuments.has(path),data:savedDocuments.get(path)}));
  }
 }
 else if(req.url==='/templates/Plantilla_Horas_Extras.xlsx'&&extraHoursTemplate){res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.end(extraHoursTemplate);}
 else if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(js);}
 else if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css);}
 else {res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Prueba BUK local</title><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script src="/app.js"></script></body></html>');}
});
server.listen(port,host,()=>console.log('Editor BUK aislado: http://'+host+':'+port+'/'+(restrictConnections?'?vista=cobertura':'')));
return server;
}
