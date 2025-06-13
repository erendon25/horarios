const { initializeApp } = require("firebase/app");
const { getFirestore, doc, setDoc, serverTimestamp } = require("firebase/firestore");

const firebaseConfig = {
  apiKey: "AIzaSyDumwsFqGDE4esA-kB_51yrhTl38DeqDTs",
  authDomain: "lc-scheduler.firebaseapp.com",
  projectId: "lc-scheduler",
  storageBucket: "lc-scheduler.firebasestorage.app",
  messagingSenderId: "1054512970764",
  appId: "1:1054512970764:web:04a1998876863b4063c229",
  measurementId: "G-VKGFTSCSMS"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function createStaffSchedule(userId) {
  try {
    const scheduleRef = doc(db, "staff_schedules", userId);
    
    await setDoc(scheduleRef, {
      baseSchedule: {
        monday: { start: "09:00", end: "17:00", enabled: true },
        tuesday: { start: "09:00", end: "17:00", enabled: true },
        wednesday: { start: "09:00", end: "17:00", enabled: true },
        thursday: { start: "09:00", end: "17:00", enabled: true },
        friday: { start: "09:00", end: "17:00", enabled: true },
        saturday: { start: "09:00", end: "14:00", enabled: false },
        sunday: { start: "09:00", end: "14:00", enabled: false }
      },
      studyHours: [],
      userId: userId,
      lastUpdated: serverTimestamp()
    }, { merge: true });

    console.log("✅ Documento creado en staff_schedules/" + userId);
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

// Ejecutar con un ID de usuario real
createStaffSchedule("sruOdRMbzGbsGq38WtjO0nBUEWp1
");