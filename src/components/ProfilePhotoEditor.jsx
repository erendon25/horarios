import React, {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '../lib/supabase/client';
import {prepareProfilePhoto,profilePhotoUrls,saveProfilePhoto,removeProfilePhoto} from '../services/profilePhoto';
import ProfileAvatar from './ProfileAvatar';

export default function ProfilePhotoEditor({staffId,name}) {
  const [photo,setPhoto]=useState(null), [preview,setPreview]=useState(null);
  const [busy,setBusy]=useState(false), [error,setError]=useState(''), [notice,setNotice]=useState('');
  const [championships,setChampionships]=useState([]);
  const lock=useRef(false), generation=useRef(0);
  const refresh=useCallback(async()=>{
    const request=++generation.current;
    const [urls,recognition]=await Promise.all([
      profilePhotoUrls(supabase,[staffId]),
      // Recognition is optional: photos can be deployed before that migration.
      supabase.from('staff_profiles').select('*').eq('id',staffId),
    ]);
    if(request===generation.current){
      setPhoto(urls.get(staffId)||null);
      setChampionships(recognition.data?.[0]?.competition_recognition?.championships || []);
    }
  },[staffId]);
  useEffect(()=>{
    let alive=true;
    const load=()=>{void refresh().catch(e=>{if(alive)setError(e.message)})};
    load();
    const interval=setInterval(load,45*60*1000);
    window.addEventListener('focus',load);
    return()=>{alive=false;++generation.current;clearInterval(interval);window.removeEventListener('focus',load)};
  },[refresh]);
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview.url)},[preview]);
  const choose=async event=>{
    const file=event.target.files[0];event.target.value='';
    if(!file||lock.current)return;
    lock.current=true;setBusy(true);setError('');setNotice('');
    setPreview(null);
    try {
      const blob=await prepareProfilePhoto(file);
      setPreview({blob,url:URL.createObjectURL(blob)});
    } catch(e){setError(e.message)}
    finally {lock.current=false;setBusy(false)}
  };
  const mutate=async(remove=false)=>{
    if(lock.current)return;
    lock.current=true;setBusy(true);setError('');setNotice('');
    try {
      if(remove)await removeProfilePhoto(supabase);else await saveProfilePhoto(supabase,preview.blob);
      setPreview(null);
      await refresh();
      setNotice(remove?'Foto eliminada.':'Foto de perfil guardada.');
    } catch(e) {
      setError(e.message || 'No se confirmó el cambio. Actualiza el panel antes de reintentar.');
      await refresh().catch(()=>{});
    } finally {lock.current=false;setBusy(false)}
  };
  return <section aria-label="Foto de perfil" className="flex flex-wrap items-center gap-4 mb-6 p-4 bg-orange-50 rounded-xl">
    <ProfileAvatar name={name} src={preview?.url||photo} size={88} championAreas={championships.map(x=>x.area_name)}/>
    <div className="flex-1 min-w-0">
      <h3 className="font-semibold text-gray-800">Foto de perfil</h3>
      {championships.length>0&&<p className="text-sm font-semibold text-yellow-800">Campeón de {[...new Set(championships.map(x=>x.area_name))].join(', ')}</p>}
      <p className="text-sm text-gray-600 mb-2">Tu foto aparecerá en el fixture del concurso. JPG, PNG o WebP, hasta 10 MB.</p>
      <div className="flex flex-wrap gap-2 items-center">
        <label className={`inline-flex px-3 py-2 rounded-lg bg-orange-600 text-white font-medium ${busy?'opacity-50':'cursor-pointer'}`}>
          {photo?'Cambiar foto':'Agregar foto'}
          <input aria-label="Elegir foto de perfil" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy} onChange={choose}/>
        </label>
        {preview&&<><button type="button" className="px-3 py-2 rounded-lg bg-green-700 text-white font-medium" disabled={busy} onClick={()=>mutate()}>Guardar foto</button><button type="button" className="px-3 py-2 rounded-lg bg-white border border-gray-300" disabled={busy} onClick={()=>{setPreview(null);setError('')}}>Cancelar</button></>}
        {!preview&&photo&&<button type="button" className="px-3 py-2 rounded-lg bg-white border border-gray-300" disabled={busy} onClick={()=>{if(window.confirm('¿Eliminar tu foto de perfil?'))void mutate(true)}}>Eliminar foto</button>}
        {busy&&<span role="status" className="text-sm">Preparando o guardando foto…</span>}
      </div>
      {error&&<p role="alert" className="text-red-700 text-sm mt-2">{error}</p>}
      {notice&&<p role="status" className="text-green-800 text-sm mt-2">{notice}</p>}
    </div>
  </section>;
}
