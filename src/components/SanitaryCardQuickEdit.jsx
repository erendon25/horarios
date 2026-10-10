import { useState } from 'react';
import { Pencil } from 'lucide-react';

export default function SanitaryCardQuickEdit({ name, expiry, unlocked, onSave }) {
    const [editing, setEditing] = useState(false);
    const [date, setDate] = useState('');
    const [allowAccess, setAllowAccess] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);

    const save = async (event) => {
        event.preventDefault();
        if (saving) return;
        setSaving(true);
        setError('');
        try {
            await onSave(date, allowAccess);
            setEditing(false);
            setSaved(true);
        } catch {
            setError('No se pudo guardar el carnet. Inténtalo nuevamente.');
        } finally {
            setSaving(false);
        }
    };

    if (!editing) return <>
        <button type="button" aria-label={`Editar carnet de ${name}`}
            onClick={() => {
                setDate(expiry || '');
                setAllowAccess(Boolean(unlocked));
                setError('');
                setSaved(false);
                setEditing(true);
            }} className="mt-1 flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800">
            <Pencil size={13} /> Editar carnet
        </button>
        {saved && <p role="status" className="mt-1 text-xs text-green-700">Carnet actualizado</p>}
    </>;

    return <form onSubmit={save} className="mt-2 min-w-[210px] space-y-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
        <label className="block text-xs font-semibold text-gray-700">Fecha de vencimiento
            <input aria-label={`Vencimiento del carnet de ${name}`} type="date" required value={date}
                onChange={event => setDate(event.target.value)} disabled={saving}
                className="mt-1 block w-full rounded border border-gray-300 bg-white p-2 text-sm" />
        </label>
        <label className="flex items-start gap-2 text-xs text-gray-700">
            <input type="checkbox" checked={allowAccess} disabled={saving}
                onChange={event => setAllowAccess(event.target.checked)} />
            Permitir acceso con carnet vencido
        </label>
        <div className="flex gap-2">
            <button type="submit" disabled={saving} className="rounded bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button type="button" disabled={saving} onClick={() => setEditing(false)} className="rounded border border-gray-300 bg-white px-3 py-2 text-xs">Cancelar</button>
        </div>
        {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    </form>;
}
