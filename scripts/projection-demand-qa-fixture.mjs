// Controlled input data for upcoming projection-demand browser verification.
// No future demand formula or expected staffing results are defined here.
const weekdays = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const addDays = (date, offset) => {
 const parsed = new Date(`${date}T12:00:00Z`);
 parsed.setUTCDate(parsed.getUTCDate()+offset);
 return parsed.toISOString().slice(0,10);
};

export function makeProjectionDemandQaFixture({
 storeId='store-a', weekStart='2026-10-19', hourlySale=2000,
 generalVhl=500, generalVhlMode='manual', scheduledHoursPerDay=4,
}={}){
 const staffId=`${storeId}-projection-person`, weekEnd=addDays(weekStart,6);
 const staff=[{
  id:staffId,storeId,name:'Colaborador ficticio QA',lastName:'Proyección',
  status:'active',modality:'Full-Time',position:'COLABORADOR',isTrainee:false,
 }];
 const schedule={id:`${staffId}_${weekStart}_to_${weekEnd}`,staffId,storeId,weekKey:`${weekStart}_to_${weekEnd}`};
 for(const day of weekdays)schedule[day]={start:'10:00',end:`${String(10+scheduledHoursPerDay).padStart(2,'0')}:00`,off:false,feriado:false,position:'Vestido'};
 const salesHistory=weekdays.map((_,index)=>{
  const date=addDays(weekStart,index);
  return {id:date,salesDate:date,date,totalSales:hourlySale,totalTxs:40,
   hourlyData:{'12':{salon:hourlySale}},hourlyTxs:{'12':{salon:40}}};
 });
 const positions=[
  // Stable cocina id must remain distinguishable even after its display name changes.
  {id:'cocina',name:'Vestido',logic:'sales',factor:1,minStaff:'',maxStaff:'',department:'production'},
  // A separately created Vestido area exercises name-based recognition, if approved.
  {id:'custom-qa-1',name:'Vestido',logic:'sales',factor:1,minStaff:'',maxStaff:'',department:'production'},
  {id:'sheetout-qa',name:'Sheetout',logic:'sales',factor:2,minStaff:'',maxStaff:'',department:'production'},
  {id:'landing-qa',name:'Landing',logic:'sales',factor:0.5,minStaff:'',maxStaff:'',department:'production'},
  {id:'service-qa',name:'Salón',logic:'service',ticketAverage:40,transactionsPerCollaborator:25,factor:1,minStaff:'',maxStaff:'',department:'service'},
  {id:'driver-qa',name:'Driver',logic:'driver',ticketAverage:40,factor:1,minStaff:'',maxStaff:'',department:'service'},
  {id:'fixed-qa',name:'Limpieza',logic:'fixed',fixedStaff:2,department:'service'},
 ];
 return {
  storeId,
  configuration:{positions,manualStaffByDay:{},generalVhl,generalVhlMode},
  data:{storeId,salesHistory,staff,schedules:[schedule],salesConfigs:{}},
  inputSummary:{weekStart,weekEnd,storeId,hour:'12:00',hourlySale,generalVhl,generalVhlMode,scheduledHoursPerDay,
   note:'These are controlled inputs only; no staffing-demand formula has been assumed.'},
 };
}

export async function seedProjectionDemandQaFixture(request,base,fixture){
 const configurationResponse=await request.post(`${base}/qa-configuration`,{data:{storeId:fixture.storeId,value:fixture.configuration}});
 if(!configurationResponse.ok())throw Error(`QA configuration seed failed: ${configurationResponse.status()}`);
 const dataResponse=await request.post(`${base}/qa-data`,{data:fixture.data});
 if(!dataResponse.ok())throw Error(`QA data seed failed: ${dataResponse.status()}`);
}
