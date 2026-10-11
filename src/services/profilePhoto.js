export const PROFILE_PHOTO_BUCKET = 'profile-photos';
const INPUT_LIMIT = 10 * 1024 * 1024;
export function validateProfilePhoto(file) {
  if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type))
    throw new Error('Elige una imagen JPG, PNG o WebP.');
  if (!file.size || file.size > INPUT_LIMIT)
    throw new Error('La foto debe pesar como máximo 10 MB.');
}

export async function prepareProfilePhoto(file) {
  validateProfilePhoto(file);
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('No se pudo abrir la imagen. Elige otra foto.'); }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const side = Math.min(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';context.fillRect(0,0,512,512);
    context.drawImage(bitmap, (bitmap.width-side)/2, (bitmap.height-side)/2, side, side, 0, 0, 512, 512);
    const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',0.85));
    if (!blob || blob.size > 2*1024*1024) throw new Error('No se pudo preparar la foto. Elige otra imagen.');
    return blob;
  } finally { bitmap.close(); }
}

export async function profilePhotoUrls(client, staffIds) {
  const ids = [...new Set(staffIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const {data:photos,error} = await client.from('staff_profile_photos')
    .select('staff_id,object_path,updated_at').in('staff_id',ids);
  if (error) throw error;
  if (!photos.length) return new Map();
  const signed = await client.storage.from(PROFILE_PHOTO_BUCKET).createSignedUrls(photos.map(p=>p.object_path),3600);
  if (signed.error) throw signed.error;
  const byPath = new Map(signed.data.filter(p=>!p.error && p.signedUrl).map(p=>[p.path,p.signedUrl]));
  return new Map(photos.map(p=>{
    const url=byPath.get(p.object_path);
    return [p.staff_id,url ? `${url}${url.includes('?')?'&':'?'}v=${encodeURIComponent(p.updated_at || '')}` : null];
  }));
}

async function removePrevious(client, userId, path, currentPath) {
  if (path && path !== currentPath && path.startsWith(`${userId}/`)) {
    // Metadata already committed. A cleanup failure must not report a failed save.
    try { await client.storage.from(PROFILE_PHOTO_BUCKET).remove([path]); } catch { /* The next save overwrites the same private object. */ }
  }
}

export async function saveProfilePhoto(client, blob) {
  const {data,error} = await client.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Inicia sesión para guardar tu foto.');
  if (blob.type!=='image/jpeg' || !blob.size || blob.size > 2*1024*1024) throw new Error('La imagen preparada no es válida.');
  const path = `${data.user.id}/profile.jpg`;
  const bucket = client.storage.from(PROFILE_PHOTO_BUCKET);
  const uploaded = await bucket.upload(path,blob,{contentType:blob.type,upsert:true,cacheControl:'0'});
  if (uploaded.error) throw uploaded.error;
  const result = await client.rpc('set_own_profile_photo',{p_object_path:path});
  if (result.error) {
    // Storage/RPC errors can arrive after a commit. Keep the file and refresh
    // before retrying; deleting here could destroy the saved profile photo.
    throw result.error;
  }
  await removePrevious(client,data.user.id,result.data.previous_path,path);
  return result.data;
}

export async function removeProfilePhoto(client) {
  const {data,error} = await client.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Inicia sesión para cambiar tu foto.');
  const result = await client.rpc('set_own_profile_photo',{p_object_path:null});
  if (result.error) throw result.error;
  await removePrevious(client,data.user.id,result.data.previous_path,null);
}
