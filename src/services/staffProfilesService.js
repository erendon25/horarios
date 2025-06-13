
import {
  getDocs,
  collection,
  getFirestore,
  doc,
  updateDoc,
  deleteDoc,
  setDoc
} from "firebase/firestore";

const db = getFirestore();

export async function getAllStaffProfiles() {
  const snap = await getDocs(collection(db, "staff_profiles"));
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function updateStaffProfile(uid, data) {
  const ref = doc(db, "staff_profiles", uid);
  await updateDoc(ref, data);
}

export async function deleteStaffProfile(uid) {
  const ref = doc(db, "staff_profiles", uid);
  await deleteDoc(ref);
}

export async function createStaffProfile(uid, data) {
  const ref = doc(db, "staff_profiles", uid);
  await setDoc(ref, data);
}
