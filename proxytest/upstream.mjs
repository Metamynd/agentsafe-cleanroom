import http from 'node:http';
export const calls=[];
http.createServer(async (req,res)=>{
  let raw=''; for await(const c of req) raw+=c;
  if(req.url==='/__calls'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify(calls));}
  if(req.url==='/__reset'){calls.length=0;res.writeHead(200);return res.end('{}');}
  calls.push({path:req.url,ct:req.headers['content-type'],body:raw});
  console.log('[upstream] EXECUTED', req.url, raw);
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({charged:true,received:raw}));
}).listen(4403,()=>console.log('[upstream] :4403'));
