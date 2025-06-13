// ✅ scheduleService.js
import { db } from "../firebase";
import { collection, getDocs, query, where } from "firebase/firestore";

export async function getWorkedHolidaysByUid(uid) {
  const q = query(collection(db, "feriados_trabajados"), where("uid", "==", uid));
  const snap = await getDocs(q);
  return snap.docs.map(doc => doc.data());
}

export async function getNightHoursByUid(uid) {
  const q = query(collection(db, "nocturnidad"), where("uid", "==", uid));
  const snap = await getDocs(q);
  let total = 0;
  snap.forEach(doc => total += doc.data().horas || 0);
  return total;
}
