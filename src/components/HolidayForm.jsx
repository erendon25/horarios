import { useEffect, useState } from "react";
import {
  getFirestore,
  doc,
  getDocs,
  updateDoc,
  arrayUnion,
  collection
} from "firebase/firestore";
import { useAuth } from "../contexts/AuthContext";

function HolidayForm() {
  const { currentUser } = useAuth();
  const db = getFirestore();
  const [selectedDate, setSelectedDate] = useState("");
  const [savedDates, setSavedDates] = useState([]);
  const [profileId, setProfileId] = useState(null);

  useEffect(() => {
    const fetchHolidays = async () => {
      if (!currentUser) return;

      const snap = await getDocs(collection(db, "staff_profiles"));
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const profile = list.find(p => p.uid === currentUser.uid);

      if (profile) {
        setSavedDates(profile.pendingHolidays || []);
        setProfileId(profile.id);
      }
    };

    fetchHolidays();
  }, [currentUser, db]);

  const handleAddHoliday = async () => {
    if (!selectedDate || !profileId) return;

    const ref = doc(db, "staff_profiles", profileId);
    await updateDoc(ref, {
      pendingHolidays: arrayUnion(selectedDate)
    });

    setSavedDates(prev => [...prev, selectedDate]);
    setSelectedDate("");
  };

  return (
    <div className="max-w-md mx-auto p-6 bg-white shadow rounded">
      <h2 className="text-xl font-semibold mb-4">Registrar feriado personal</h2>
      <div className="mb-4">
        <label className="block mb-1">Selecciona una fecha</label>
        <input
          type="date"
          max={new Date().toISOString().split("T")[0]}
          value={selectedDate}
          onChange={e => setSelectedDate(e.target.value)}
          className="w-full border p-2 rounded"
        />
      </div>
      <button
        onClick={handleAddHoliday}
        className="bg-blue-600 text-white px-4 py-2 rounded w-full"
        disabled={!selectedDate}
      >
        Agregar feriado
      </button>

      <h3 className="text-lg font-medium mt-6 mb-2">Tus feriados registrados</h3>
      {savedDates.length > 0 ? (
        <ul className="list-disc ml-5 text-sm">
          {savedDates.map((date, idx) => (
            <li key={idx}>{date}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-600">Aún no has registrado feriados.</p>
      )}
    </div>
  );
}

export default HolidayForm;

