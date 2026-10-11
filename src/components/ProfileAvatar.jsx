import React, { useState } from 'react';

const EMPTY_AREAS = [];
const LEAVES = [[25,77,-40],[18,65,-30],[15,52,-20],[17,39,0],[23,27,20],[33,18,45]];
export default function ProfileAvatar({name='',src,size=48,championAreas=EMPTY_AREAS}) {
  const [failedSource,setFailedSource] = useState(null);
  const champion = championAreas.length > 0;
  const diameter = champion ? size * .74 : size;
  const style={width:diameter,height:diameter,minWidth:diameter,borderRadius:'50%',objectFit:'cover',display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0,background:'#fff0df',color:'#963a0a',fontWeight:800,fontSize:size/3,border:champion?'2px solid #d4a017':'2px solid #f7bc91'};
  const portrait = src && src !== failedSource
    ? <img src={src} alt={`Foto de ${name}`} style={style} onError={()=>setFailedSource(src)} />
    : <svg role="img" aria-label={`Imagen predeterminada de ${name || 'colaborador'}`} viewBox="0 0 100 100" style={style}>
        <circle cx="50" cy="34" r="17" fill="#bc9478"/>
        <path d="M18 100V87c0-19 14-32 32-32s32 13 32 32v13Z" fill="#bc9478"/>
      </svg>;
  if (!champion) return portrait;
  const label = `Campeón de ${[...new Set(championAreas)].join(', ')}`;
  return <span title={label} style={{position:'relative',width:size,height:size,minWidth:size,flexShrink:0,display:'inline-flex',alignItems:'center',justifyContent:'center'}}>
    {portrait}
    <svg role="img" aria-label={`Laureles: ${label}`} viewBox="0 0 100 100" style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none'}}>
      <path d="M50 94 Q7 85 18 30 M50 94 Q93 85 82 30" fill="none" stroke="#a77709" strokeWidth="2.5"/>
      {[false,true].map(mirror=><g key={String(mirror)} transform={mirror?'translate(100 0) scale(-1 1)':undefined} fill="#e5b631" stroke="#996d09" strokeWidth=".6">
        {LEAVES.map(([x,y,angle])=><ellipse key={y} cx={x} cy={y} rx="4.5" ry="9" transform={`rotate(${angle} ${x} ${y})`}/>)}
      </g>)}
    </svg>
  </span>;
}
