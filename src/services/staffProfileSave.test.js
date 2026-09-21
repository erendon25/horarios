import test from 'node:test';
import assert from 'node:assert/strict';
import { staffProfilePayload, saveStaffFromModal } from './staffProfileSave.js';

const form = { name: ' Persona ', lastName: ' Prueba ', email: '', dni: '',
  modality: 'Full-Time', position: 'COLABORADOR', joinDate: '2026-09-09',
  sanitaryCardDate: '2027-01-01', cessationDate: '', isTrainee: false };
const storeId = '11111111-1111-4111-8111-111111111111';
const savedId = '22222222-2222-4222-8222-222222222222';

test('alta usa la RPC autorizada con ID generado por la base, campos canónicos y sin correo obligatorio', async () => {
  const calls = [];
  let confirmed;
  const result = await saveStaffFromModal({ rpc: async (name, args) => {
    calls.push({ name, args }); return { data: savedId, error: null };
  } }, { form, staff: null, storeId, staffId: null, onProfileSaved: id => { confirmed = id; } });
  assert.equal(result, savedId);
  assert.equal(confirmed, savedId);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'save_staff_profile');
  assert.equal(calls[0].args.p_staff_id, null);
  assert.equal(calls[0].args.p_email, null);
  assert.equal(calls[0].args.p_first_name, 'Persona');
  assert.equal(calls[0].args.p_sanitary_card_expiry, '2027-01-01');
  assert.equal(calls[0].args.p_status, 'pending');
  assert.equal(Object.keys(calls[0].args).length, 18);
});

test('editar preserva identidad, estado y nacimiento que no se edita en el modal', () => {
  const args = staffProfilePayload(form, { id: savedId, status: 'active', birthDate: '2000-01-01' }, storeId);
  assert.equal(args.p_staff_id, savedId);
  assert.equal(args.p_status, 'active');
  assert.equal(args.p_birth_date, '2000-01-01');
});

test('rechaza formulario incompleto antes de llamar al servidor', async () => {
  const client = { rpc: () => assert.fail('No debe llamar la RPC') };
  for (const invalid of [{ ...form, name: ' ' }, { ...form, nextModality: 'Part-Time' }]) {
    await assert.rejects(saveStaffFromModal(client, { form: invalid, storeId }));
  }
  assert.throws(() => staffProfilePayload(form, null, null), /tienda/);
});

test('un rechazo de permisos no confirma un perfil ni ejecuta el cese', async () => {
  let calls = 0;
  await assert.rejects(saveStaffFromModal({ rpc: async () => {
    calls++; return { error: { message: 'No tienes permiso para administrar colaboradores' } };
  } }, { form, storeId, onProfileSaved: () => assert.fail('Perfil no guardado') }), /No tienes permiso/);
  assert.equal(calls, 1);
});

test('un fallo parcial de cese conserva el ID y el reintento actualiza sin duplicar el alta', async () => {
  const submitted = { ...form, cessationDate: '2026-10-01' };
  const calls = [];
  let confirmedId = null;
  let failCessation = true;
  const client = { rpc: async (name, args) => {
    calls.push({ name, args });
    return name === 'save_staff_profile' ? { data: savedId } : { error: failCessation ? { message: 'Cese rechazado' } : null };
  } };
  const options = () => ({ form: submitted, staff: null, storeId, staffId: confirmedId,
    onProfileSaved: id => { confirmedId = id; } });
  await assert.rejects(saveStaffFromModal(client, options()), /El perfil ya se guardó/);
  assert.equal(confirmedId, savedId);
  failCessation = false;
  await saveStaffFromModal(client, options());
  assert.equal(calls[0].args.p_staff_id, null);
  assert.equal(calls[2].args.p_staff_id, savedId);
  assert.deepEqual(calls[3], { name: 'save_staff_cessation', args: { p_staff_id: savedId, p_cessation_date: '2026-10-01' } });
});

test('quitar una fecha de cese utiliza la función protegida, no escrituras directas', async () => {
  const calls = [];
  await saveStaffFromModal({ rpc: async (name, args) => {
    calls.push({ name, args }); return { data: savedId };
  } }, { form, staff: { id: savedId, cessationDate: '2026-10-01' }, storeId, onProfileSaved: () => {} });
  assert.equal(calls[1].name, 'save_staff_cessation');
  assert.equal(calls[1].args.p_cessation_date, null);
});
