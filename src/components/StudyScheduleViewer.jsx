import { useEffect, useState } from "react";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import { useParams } from "react-router-dom";

function StudyScheduleViewer() {
  const { id } = useParams(); // ID del colaborador (uid)
  const [studySchedule, setStudySchedule] = useState({});
  const db = getFirestore();

  useEffect(() => {
    const fetchSchedule = async () => {
      const docRef = doc(db, "study_schedules", id);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        setStudySchedule(snap.data());
      }
    };

    fetchSchedule();
  }, [id, db]);

  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const dayLabels = {
    monday: "Lunes",
    tuesday: "Martes",
    wednesday: "Miércoles",
    thursday: "Jueves",
    friday: "Viernes",
    saturday: "Sábado",
    sunday: "Domingo"
  };

  return (
    <div className="p-6 max-w-2xl mx-auto bg-white shadow rounded">
      <h2 className="text-xl font-bold mb-4">Disponibilidad registrada</h2>
      <ul className="space-y-3">
        {days.map(day => {
          const blocks = studySchedule[day];
          if (!blocks || blocks.length === 0) return null;

          return (
            <li key={day} className="border p-4 rounded">
              <h3 className="font-semibold mb-2">{dayLabels[day]}</h3>
              <ul className="list-disc ml-6 text-sm">
                {blocks.map((block, idx) => (
                  <li key={idx}>
                    {block.start} - {block.end}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default StudyScheduleViewer;
