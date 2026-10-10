// Observable scoring defaults. Administrators can refine these in draft.
export const PROCEDURE_CHECKS = {
  Landing: ['Retira el producto del horno con las herramientas correspondientes.', 'Usa el cortador correspondiente al tipo de pizza.', 'Realiza la secuencia de cortes correspondiente al producto.', 'Realiza el empaque correspondiente al pedido.', 'Marca el vencimiento del producto terminado.'],
  'Landing Crazy': ['Transfiere el producto a la bandeja con la herramienta correspondiente.', 'Aplica el spread correspondiente al producto.', 'Aplica el acabado correspondiente al producto elegido.', 'Transfiere el producto al papel o envase correspondiente.', 'Envuelve, embolsa y marca el producto según corresponda.'],
  Vestido: ['Selecciona la base correspondiente al producto.', 'Aplica la salsa correspondiente.', 'Aplica el queso correspondiente.', 'Coloca los ingredientes correspondientes al producto.', 'Traslada el producto al ready rack e inicia su control de tiempo.'],
  Sheetout: ['Selecciona la masa con maduración y rotación correspondientes.', 'Prepara el molde con corn meal.', 'Retira y enharina la bola de masa con las herramientas correspondientes.', 'Forma el borde y realiza los pases por el sheeter correspondientes.', 'Estira y coloca el sheetout en el molde con la orientación correspondiente.'],
  Masa: ['Identifica los ingredientes de la receta correspondiente.', 'Prepara la mezcla siguiendo la secuencia de la receta.', 'Divide la masa en los bollos correspondientes.', 'Realiza el boleado y coloca los bollos en la bandeja.', 'Fecha y traslada la masa a la cámara aplicando rotación.'],
  'Drive Thru': ['Saluda y recibe el pedido del cliente.', 'Confirma el pedido antes de registrarlo.', 'Registra el pedido en el canal correspondiente.', 'Confirma el pago y el comprobante.', 'Entrega el pedido y cierra la atención.'],
  Servicio: ['Recibe al cliente y solicita su pedido.', 'Confirma la orden antes de registrarla.', 'Registra los productos solicitados.', 'Confirma el pago y el comprobante.', 'Informa el tiempo de entrega y cierra la atención.'],
};
export const CRITERION_CHECKS = {
  'Porcionamiento / cantidades': ['Usa la medida indicada para la base o porción principal.', 'Usa la cantidad indicada del primer insumo de la receta.', 'Usa la cantidad indicada del segundo insumo de la receta.', 'Usa las cantidades indicadas de los complementos.', 'El resultado contiene todas las porciones requeridas, sin sobrantes ni faltantes.'],
  Presentación: ['El producto conserva la forma requerida.', 'La distribución visible de los ingredientes es uniforme.', 'El producto no presenta roturas o deformaciones.', 'El envase o empaque está limpio y correctamente cerrado.', 'El acabado corresponde al producto solicitado.'],
  'Presentación / orden': ['El producto presenta el acabado requerido.', 'El empaque está limpio y cerrado.', 'El pedido se presenta organizado.', 'Los productos y complementos están identificados.', 'La zona de entrega queda ordenada.'],
  Técnica: ['Sujeta y controla las herramientas durante la ejecución.', 'Ejecuta los movimientos sin dañar el producto.', 'Mantiene la uniformidad durante la ejecución.', 'Resuelve el ejercicio sin maniobras que requieran rehacer el producto.', 'Termina la operación con el producto íntegro.'],
  'Orden y limpieza': ['El área está limpia al comenzar.', 'Los utensilios están limpios y listos.', 'Los insumos están ordenados durante el ejercicio.', 'Retira los residuos generados.', 'Limpia y ordena el área al finalizar.'],
  Orden: ['Prepara los elementos necesarios antes de empezar.', 'Mantiene organizados los pedidos o productos.', 'Mantiene despejada el área de trabajo.', 'Retira los elementos que ya no utiliza.', 'Deja ordenada la estación al finalizar.'],
  'Seguridad/manipulación': ['Realiza la higiene de manos correspondiente.', 'Evita el contacto del alimento con superficies no sanitizadas.', 'Usa las herramientas y protección correspondientes.', 'Evita la contaminación cruzada.', 'Mantiene los controles de conservación que corresponden al producto.'],
  'Exactitud del pedido': ['El producto principal coincide con la orden.', 'La cantidad de unidades coincide con la orden.', 'Los ingredientes o modificaciones coinciden con la orden.', 'Las bebidas o complementos coinciden con la orden.', 'Confirma el pedido completo antes de entregarlo.'],
  Exactitud: ['Identifica el producto solicitado.', 'Confirma la cantidad solicitada.', 'Registra las modificaciones solicitadas.', 'Registra los complementos solicitados.', 'Verifica que el registro final coincide con lo confirmado por el cliente.'],
  'Entrega correcta': ['Entrega el pedido al cliente correspondiente.', 'Entrega todos los productos de la orden.', 'Entrega todos los complementos requeridos.', 'Entrega el comprobante correspondiente.', 'Verifica con el cliente la entrega del pedido completo.'],
  Atención: ['Saluda al cliente al iniciar.', 'Escucha el pedido sin interrumpir.', 'Responde las consultas del cliente.', 'Informa de forma clara el pedido y el tiempo de entrega.', 'Agradece e invita al cliente a regresar.'],
  'Atención / comunicación': ['Saluda y establece contacto con el cliente.', 'Escucha y confirma el pedido.', 'Comunica claramente las indicaciones necesarias.', 'Informa el tiempo de entrega.', 'Agradece y cierra la atención.'],
};
export function defaultChecklist(area, label, max) {
  const amount = Number(max);
  if (['Tiempo','Rapidez'].includes(label)) return [{id:'tiempo',label:'El tiempo registrado no supera el máximo del área.',points:amount,automatic:'time_limit'}];
  const labels = ['Procedimiento correcto','Procedimiento'].includes(label) ? PROCEDURE_CHECKS[area] : CRITERION_CHECKS[label];
  if (!labels) return [];
  if (amount < .05) return [{id:'paso_1',label:labels[0],points:amount}];
  const cents=Math.round(amount*100), base=Math.floor(cents/labels.length);
  return labels.map((text,i)=>({id:`paso_${i+1}`,label:text,points:(i===labels.length-1?cents-base*(labels.length-1):base)/100}));
}
export function checklistScore(checklist, decisions, evaluation) {
  return Math.round(checklist.reduce((sum,step)=>sum+(checkFulfilled(step,decisions,evaluation)?Number(step.points):0),0)*100)/100;
}
export function checkFulfilled(step,decisions,evaluation) {
  return step.automatic==='time_limit'
    ? evaluation.duration_ms != null && Number(evaluation.duration_ms)<=Number(evaluation.maximum_duration_ms)
    : decisions?.[step.id]===true;
}
