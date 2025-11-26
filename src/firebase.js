import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getAnalytics } from "firebase/analytics";
import { getStorage } from 'firebase/storage';
export const firebaseConfig = {
  apiKey: "AIzaSyDumwsFqGDE4esA-kB_51yrhTl38DeqDTs",
  authDomain: "lc-scheduler.firebaseapp.com",
  projectId: "lc-scheduler",
  storageBucket: "lc-scheduler.appspot.com",
  messagingSenderId: "1054512970764",
  appId: "1:1054512970764:web:04a1998876863b4063c229",
  measurementId: "G-VKGFTSCSMS"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
// 🔧 Aquí se expone a la consola del navegador
if (typeof window !== "undefined") {
  window._firestore = db;
}
export default app;