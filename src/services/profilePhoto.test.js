import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProfilePhoto,saveProfilePhoto,removeProfilePhoto,profilePhotoUrls} from './profilePhoto.js';
test('rechaza imágenes inválidas o demasiado grandes antes de leerlas',()=>{
  for(const file of [null,{type:'image/svg+xml',size:50},{type:'image/png',size:0},{type:'image/jpeg',size:11*1024*1024}])assert.throws(()=>validateProfilePhoto(file));
  assert.doesNotThrow(()=>validateProfilePhoto({type:'image/png',size:1024}));
});
function client({uploadError=null,rpcError=null,removeError=null}={}) {
  const calls=[];
  return {calls,auth:{getUser:async()=>({data:{user:{id:'my-account'}}})},
    storage:{from:()=>({upload:async(path,blob,options)=>{calls.push(['upload',path,options]);return {error:uploadError}},remove:async paths=>{calls.push(['remove',paths]);if(removeError)throw removeError;return {error:null}}})},
    rpc:async(name,args)=>{calls.push(['rpc',name,args]);return {data:{object_path:args.p_object_path,previous_path:'my-account/profile.jpg'},error:rpcError}}};
}
test('Storage rechaza la subida: no solicita el cambio de metadata',async()=>{
  const c=client({uploadError:new Error('Fallo de red')});
  await assert.rejects(()=>saveProfilePhoto(c,new Blob(['valid'],{type:'image/jpeg'})),/Fallo de red/);
  assert.equal(c.calls.length,1);
});
test('respuesta ambigua de la RPC conserva el archivo y la foto anterior',async()=>{
  const c=client({rpcError:new Error('No se confirmó')});
  await assert.rejects(()=>saveProfilePhoto(c,new Blob(['valid'],{type:'image/jpeg'})),/No se confirmó/);
  assert.equal(c.calls.some(call=>call[0]==='remove'),false);
});
test('reemplaza un único archivo de la cuenta sin eliminar los enlaces de otras pestañas',async()=>{
  const c=client();
  const result=await saveProfilePhoto(c,new Blob(['valid'],{type:'image/jpeg'}));
  assert.equal(result.object_path,'my-account/profile.jpg');
  assert.deepEqual(c.calls.map(call=>call[0]),['upload','rpc']);
  assert.equal(c.calls[0][2].upsert,true);
  assert.equal(c.calls[0][2].cacheControl,'0');
});
test('eliminar primero confirma el cambio y después elimina el archivo',async()=>{
  const c=client();await removeProfilePhoto(c);
  assert.deepEqual(c.calls.map(call=>call[0]),['rpc','remove']);
  assert.equal(c.calls[0][2].p_object_path,null);
  const cleanupFailure=client({removeError:new Error('Temporal')});
  await assert.doesNotReject(()=>removeProfilePhoto(cleanupFailure));
});
test('resuelve varias fotos por UUID en una firma de URLs, sin depender del orden de respuesta',async()=>{
  const c={from:()=>({select(){return this},in:async()=>({data:[{staff_id:'a',object_path:'a.webp'},{staff_id:'b',object_path:'b.webp'}],error:null})}),storage:{from:()=>({createSignedUrls:async(paths,expiry)=>{assert.equal(expiry,3600);assert.equal(paths.length,2);return {data:[{path:'b.webp',signedUrl:'signed-b'},{path:'a.webp',signedUrl:'signed-a'}],error:null}}})}};
  assert.deepEqual([...await profilePhotoUrls(c,['a','b','a'])],[['a','signed-a?v='],['b','signed-b?v=']]);
});
