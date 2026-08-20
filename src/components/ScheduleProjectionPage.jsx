import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, AlertCircle, RefreshCw } from "lucide-react";
import { collection, getDocs, query, where } from "../lib/supabase/firestoreCompat";
import { useAuth } from "../contexts/AuthContext";
import { db } from "../supabase";
import ScheduleProjectionDashboard from "./ScheduleProjectionDashboard";

export default function ScheduleProjectionPage() {
  const navigate = useNavigate();
  const { userData } = useAuth();
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);

  const fetchStaff = async () => {
    if (!userData?.storeId) {
      setStaff([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const staffQuery = query(
        collection(db, "staff_profiles"),
        where("storeId", "==", userData.storeId)
      );
      const snapshot = await getDocs(staffQuery);
      setStaff(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    } catch (err) {
      console.error("Error al cargar colaboradores para proyeccion:", err);
      setError("No se pudo cargar la plantilla para calcular el VHL general.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStaff();
  }, [userData?.storeId]);

  const refreshAllData = () => {
    setRefreshToken((current) => current + 1);
    fetchStaff();
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate("/admin")}
            className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-orange-600 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver al panel admin
          </button>

          <button
            type="button"
            onClick={refreshAllData}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-60 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Actualizar datos
          </button>
        </div>
      </div>

      {error && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        </div>
      )}

      {loading ? (
        <div className="min-h-[60vh] flex items-center justify-center text-slate-500 font-semibold">
          Cargando ventas, horarios y VHL general...
        </div>
      ) : (
        <ScheduleProjectionDashboard
          staffList={staff}
          storeId={userData?.storeId}
          refreshToken={refreshToken}
        />
      )}
    </div>
  );
}
