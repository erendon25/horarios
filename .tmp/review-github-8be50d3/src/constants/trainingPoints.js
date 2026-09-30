export const SERVICE_GENERAL_POINTS = [
  {
    id: 'appearance',
    title: '¿Está listo para trabajar?',
    points: [
      { id: 1, text: 'Uniforme limpio y organizado (gorra, polo y mandil), pantalón, cinturón, medias y calzado de acuerdo al estándar, gafete visible a la altura del pecho con su nombre, cabello corto y/o recogido, uñas cortas, limpias y sin esmalte, sin pestañas postizas, no usar anillos, pulseras, piercings y/o relojes, barba afeitada.' }
    ]
  },
  {
    id: 'hygiene',
    title: '¿Manos limpias?',
    points: [
      { id: 2, text: 'Se lava las manos con jabón antibacterial cada 20 minutos y/o cuando sea necesario, siguiendo los pasos que indica la ayuda visual de Lavado de Manos.' }
    ]
  },
  {
    id: 'preparation',
    title: 'Preparación de turno',
    points: [
      { id: 3, text: 'Pregunta al responsable de turno los objetivos (transacciones, ticket promedio, ventas, participación por canal) y las promociones y/o productos a sugerir.' },
      { id: 4, text: 'Se asegura que el área este limpia y abastecida, siguiendo los estándares y metodología PEPS.' }
    ]
  }
];

export const SERVICE_STATIONS = {
  SERVICIO: {
    title: 'Servicio (Módulo / Auto / Counter)',
    points: [
      { id: 1, text: 'Mantiene su posición, no le da la espalda al invitado ni deja solo el mostrador.' },
      { id: 2, text: 'Recibe al invitado con una sonrisa genuina. Saluda utilizando un tono de voz cálido, sin gritar, generando contacto visual y con amabilidad utilizando el speech correspondiente: ¡Buenos días/tardes/noches! ¡Bienvenido a Little Caesars! ¿Cuál es su pedido HOT-N-READY del día de hoy?' },
      { id: 3, text: 'Alerta la apertura de otra caja al existir dos invitados o más en el mostrador.' },
      { id: 4, text: 'Ofrece los productos de oferta por tiempo limitado (LTO): ¿Le gustaría probar nuestro nuevo "xxxx"? asintiendo con el rostro y denotando seguridad ante el invitado.' },
      { id: 5, text: 'Conoce la descripción de todos los productos del menú. Realiza venta sugestiva para despertar la necesidad en el invitado con los objetivos del turno: "Anímese a probar unos deliciosos \"xxxx\" recién salidos del horno", ¿Acompaña su pedido con una gaseosa helada? "Un dip de Chesse Jalapeño combina muy bien con este producto, anímese a probarlo".' },
      { id: 6, text: 'Repite la orden para acentuar lo que el invitado pide y confirmar lo que está digitando.' },
      { id: 7, text: 'Indica el total, pregunta la forma de pago y el tipo de comprobante a generar (boleta electrónica o factura).' },
      { id: 8, text: 'Si la compra es en efectivo, menciona la denominación del billete recibido y aplica los acciones básicas para detección de billetes falsos. En caso de dudas, solicita la asistencia del responsable de turno. Menciona el cambio a entregar y lo coloca en el mostrador junto al comprobante de pago.' },
      { id: 9, text: 'Si la compra es con yape, plin, tarjetas de débito y/o crédito se asegura que el pago sea correcto.' },
      { id: 10, text: 'Le indica al cliente el tiempo de entrega de su pedido. En caso de ser un pedido especial o que no está dentro de la categoría HOT-N-READY menciona el tiempo de espera.' }
    ]
  },
  DESPACHO: {
    title: 'Despacho',
    points: [
      { id: 1, text: 'Aplica la correcta comunicación (CCCA) al área de landing y/o pizza dress del pedido.' },
      { id: 2, text: 'Se aplica alcohol en gel antes de realizar cualquier actividad.' },
      { id: 3, text: 'Completa el pedido cuando se encuentran todos los productos listos en el cres cor; en caso sea un pedido especial, realiza seguimiento al tiempo faltante.' },
      { id: 4, text: 'Revisa la orden, asegurándose que sea el producto correcto, cumpla con las características de calidad y esté dentro del tiempo de vida.' },
      { id: 5, text: 'Llamar al invitado por su nombre utilizando un tono de voz cálido y sin gritar.' },
      { id: 6, text: 'Muestra al invitado su producto con la descripción, entrega la cantidad correcta de condimentos (2 óreganos y 1 ají) y 4 servilletas.' },
      { id: 7, text: 'Agradece su compra y lo invita a regresar: ¡Gracias por su compra, vuelva pronto a Little Caesars! Disfrute su pedido.' },
      { id: 8, text: 'Una vez se retira el invitado aplica sanitizante con el aspersor y desinfecta el área con el paño correspondiente.' },
      { id: 9, text: 'Realiza el abastecimiento de bebidas, dips y cups siguiendo el método PEPS, aprovechando los momentos de menor afluencia de clientes.' }
    ]
  },
  DELIVERY: {
    title: 'Delivery',
    points: [
      { id: 1, text: 'Verifica la conexión y sonido en todos los aplicativos (Rappi, Pedidos Ya y DiDi).' },
      { id: 2, text: 'Acepta la orden inmediatamente el pedido aparece en el aplicativo.' },
      { id: 3, text: 'Aplica la correcta comunicación (CCCA) al área de landing, indicando que el pedido es para Delivery.' },
      { id: 4, text: 'Digita el pedido de manera correcta (canal y aplicativo que corresponde) revisando que el precio del sistema coincida con el del aplicativo.' },
      { id: 5, text: 'Mantiene las boletas y/o facturas organizadas según el orden de entrega.' },
      { id: 6, text: 'Se aplica alcohol en gel antes de realizar cualquier actividad.' },
      { id: 7, text: 'Completa el pedido cuando se encuentran todos los productos listos en el cres cor.' },
      { id: 8, text: 'Revisa la orden, asegurándose que sea el producto correcto, cumpla con las características de calidad y esté dentro del tiempo de vida. De estar ok, procede a colocar el sticker de seguridad.' },
      { id: 9, text: 'Recibe al motorizado con amabilidad y pregunta el número de pedido y aplicativo. Luego le indica la cantidad de tiempo restante para la entrega, en caso de que sea pedido especial.' },
      { id: 10, text: 'Añade la boleta y/o factura a la caja junto al volante vigente pegados de manera correcta con una cinta scotch.' },
      { id: 11, text: 'Una vez que el motorizado revisa su pedido, solicita que confirme en su aplicativo el botón de retirado.' },
      { id: 12, text: 'Realiza el abastecimiento de la zona de Delivery aplicando el método PEPS, aprovechando los momentos de menor afluencia de invitados.' }
    ]
  },
  TRAFICO: {
    title: 'Servicio al Auto / Tráfico',
    points: [
      { id: 1, text: 'Utiliza el EPP y/o uniforme destinado para la actividad (casaca o chaleco con cintas reflectivas, mochila y canguro), verificando que se encuentre limpio y en buenas condiciones.' },
      { id: 2, text: 'Se asegura que cuenta con todo lo necesario para realizar esta actividad: Menú enmicado, POS cargado, bolígrafo, calculadora, óregano y ají.' },
      { id: 3, text: 'Aborda el auto cuando se estaciona, aplica el saludo protocolar y le facilita el menú al cliente para que pueda apreciar las diferentes opciones.' },
      { id: 4, text: 'Describe los productos, se muestra atento a las consultas del cliente y sobre ello realiza venta sugestiva.' },
      { id: 5, text: 'Repite la orden para acentuar lo que el invitado pide y confirmar el pedido.' },
      { id: 6, text: 'Indica el total, pregunta la forma de pago y el tipo de comprobante a generar (boleta electrónica o factura).' },
      { id: 7, text: 'Si la compra es en efectivo, recibe el dinero y se dirige al área de caja para registrar la transacción. Se asegura que el Embajador de Servicio digite correctamente el pedido y lo registre en el canal de Servicio al Auto. Recibe el comprobante y el cambio.' },
      { id: 8, text: 'Si la compra es con yape, plin, tarjetas de débito y/o crédito tiene a la mano el POS, se asegura que el pago sea correcto y se dirige a la estación de caja para registrar la transacción. Se asegura que el Embajador de Servicio digite correctamente el pedido y lo registre en el canal de Servicio al Auto. Recibe el comprobante y el cambio.' },
      { id: 9, text: 'Revisa la orden, asegurándose que sea el producto correcto, cumpla con las características de calidad y esté dentro del tiempo de vida.' },
      { id: 10, text: 'Lleva el pedido al auto, asegurándose de llevar las cajas y gaseosas en viajes separados (depende de cantidad de productos). Agradece su compra y lo invita a regresar: ¡Gracias por su compra, vuelva pronto a Little Caesars! Disfrute su pedido.' }
    ]
  }
};

export const PRODUCTION_GENERAL_POINTS = [
  {
    id: 'appearance',
    title: '¿Está listo para trabajar?',
    points: [
      { id: 1, text: 'Uniforme limpio y organizado(gorra, polo y mandil), pantalón, cinturón, medias y calzado de acuerdo al estándar, gafete visible a la altura del pecho con su nombre, cabello corto y/o recogido, uñas cortas, limpias y sin esmalte, sin pestañas postizas, no usar anillos, pulseras, piercings y/o relojes, barba afeitada.' },
      { id: 2, text: 'El colaborador conoce y recita la Promesa al Invitado y explica su signifcado e importancia para el desarrollo de sus funciones' }
    ]
  },
  {
    id: 'hygiene',
    title: '¿Manos limpias?',
    points: [
      { id: 3, text: 'Se lava las manos con jabón antibacterial cada 20 minutos y/o cuando sea necesario, siguiendo los pasos que indica la ayuda visual de Lavado de Manos.' }
    ]
  },
  {
    id: 'preparation',
    title: 'Metas y Herramientas',
    points: [
      { id: 4, text: 'Pregunta al Gerente los objetivos del turno y consulta la estación al que está designado ese día, asimismo tiene claro el seguimiento, cumplimiento y manejo de sus proyecciones.' },
      { id: 5, text: 'Se asegura que el área este limpia y abastecida, siguiendo los estándares y metodología PEPS.' },
      { id: 6, text: 'El colaborador utiliza la herramienta de desempeño en cada estación y demuestra su correcto uso.' }
    ]
  }
];

export const PRODUCTION_STATIONS = {
  PREPARACION: {
    title: 'Preparación de Productos (Dough Mix / Salsa / Otros)',
    points: [
      { id: 1, text: 'Mantiene su posición y sigue las proyecciones de preparación de cada producto según el DO SHEET.' },
      { id: 2, text: 'El colaborador conoce y explica los ingredientes y la preparación de la receta para los lotes de masa, teniendo en cuenta el tiempo de reposo y las cantidades necesarias de cada insumo.' },
      { id: 3, text: 'El colaborador conoce y explica el proceso de limpieza y sanitización de verduras.' },
      { id: 4, text: 'El colaborador toma la temperatura del agua que usará para la mezcla del dough mix (60-70 °F).' },
      { id: 5, text: 'El colaborador toma la temperatura de salida de la masa (máx 85 °F).' },
      { id: 6, text: 'El colaborador corta y pesa de manera correcta los bollos de masa (18oz - 10oz).' },
      { id: 7, text: 'El colabotador engrasa la bandeja de masa y la fecha de manera correcta utilizando un Day Dot.' },
      { id: 8, text: 'El colaborador realiza un correcto boleado de la masa y demuestra como colocarla en la bandeja, siguiendo el patrón 3-4-3 o 5-5-5 según corresponda.' },
      { id: 9, text: 'El colaborador traslada la masa y realiza una correcta rotación de la misma dentro de la cámara fría.' },
      { id: 10, text: 'El colaborador conoce y explica la secuencia correcta de los ingredientes para la preparación de la salsa.' },
      { id: 11, text: 'El colaborador conoce la temperatura adecuada del algua para la preparación de la salsa.' },
      { id: 12, text: 'El colaborador utiliza el batidor de globo con mango de acero para batir la salsa pizza en forma de \"8\" almenos 100 veces.' },
      { id: 13, text: 'El colaborador trasfiere la mezcla a un lexan, lo fecha utilizando el Day Dot correspondiente, lo tapa y lleva a la cámara fría.' },
      { id: 14, text: 'El colaborador conoce el tiempo de reposo y vida útil de cada uno de los productos del DO SHEET.' },
      { id: 15, text: 'El colaborador conoce y demuestra el estandar para el corte de frutas y vegetales (piña, champiñones y pimientos).' },
      { id: 16, text: 'El colaborador conoce y desmuestra el proceso de descongelamiento del queso IQF.' },
      { id: 17, text: 'El colaborador conoce y demuestra el proceso de descongelamiento del tocino.' },
      { id: 18, text: 'El colaborador conoce y desmuestra la preparación de la mezcla para las Cinnamon Stix (Canelitas).' },
      { id: 19, text: 'El colaborador conoce y desmuestra la preparación de la mezcla de Veggie Seasoning.' },
      { id: 20, text: 'El colaborador conoce los tiempos de vida útil de los productos una vez abiertos y aplica el fechado correcto en el recipiente plástico.' },
      { id: 21, text: 'El colaborador utiliza correctamente los recipientes plásticos para almacenar insumos en la cámara fría, de acuerdo al DO SHEET.' },
      { id: 22, text: 'El colaborador conoce y aplica el método PEPS para el orden de los productos dentro de la cámara fría.' }
    ]
  },
  SHEETOUT: {
    title: 'Sheetout',
    points: [
      { id: 1, text: 'Mantiene su posición y sigue sus proyecciones.' },
      { id: 2, text: 'En caso de que la venta no esté acorde a sus proyecciones, se lo hace saber al responsable del turno para que las aumente o disminuya según corresponda.' },
      { id: 3, text: 'Está constantemente pendiente del vencimiento de sus torres de sheetout y complementos.' },
      { id: 4, text: 'El colaborador selecciona y retira la masa con la debida maduración, con base en el método de rotación PEPS.' },
      { id: 5, text: 'El colaborador toma la temperatura de la masa y espera a que alcance una temperatura de entre 40 a 45 °F.' },
      { id: 6, text: 'El colaborador espolvorea con el shaker una capa de corn meal degrasor medio y de manera uniforme. Y responde a: ¿Para que sirve el uso del corn meal?. (para evitar que se pegue al molde, que el calor dentro del horno se distribuya en toda la pizza de manera uniforme, y reitera nuestro sabor y textura característicos).' },
      { id: 7, text: 'El colaborador utiliza un raspador plástico para retirar las bolas de masa, conservándolas lo más redondas posibles.' },
      { id: 8, text: 'El colaborador explica y demuestra, el por qué y cómo enharinamos las bolas de masa. (absorber el exceso de aceite y que no se pregue en el sheeter).' },
      { id: 9, text: 'El colaborador utiliza el método de \"la doble aspa o doble X\" para obtener el borde blanco suave. Y responde a: ¿para qué sirve formarlo? (para formar la parte crujiente y que los rodillos sujeten bien la masa).' },
      { id: 10, text: 'El colaborador coloca la masa en el sheeter y la gira 90° para pasarla por los rodillos inferiores. Y responde a, ¿Con cuánto de diámetro debe de salir la masa del sheeter?. (12\" - 13\").' },
      { id: 11, text: 'El colaborador debe enharinar ligeramente un área de 16\" en la mesa de sheetout. Y responde a, ¿Qué pasa cuando utilizamos demasiada harina?. (ocasiona que la parte crujiente de la pizza no se dore uniformemente).' },
      { id: 12, text: 'El colaborador debe colocar el sheetout con la parte crujiente hacia abajo, sobre un área de la mesa ligeramente enharinada, y luego debe estirarse desde el exterior de 3 a 4 veces sin que queden bordes aplanados o manchas finas en el sheetout. Y responde a, ¿Por qué se estiran sobre una mesa?. (para evitar manchas finas en el sheetout y permitir que sean más gruesos al colocarlos en el molde).' },
      { id: 13, text: 'El colaborador menciona las características de calidad de un sheetout perfecto. (borde blanco suave de 1\", se ajusta al molde, sin hoyos, roturas, manchas finas o arrugas, parte crujiente hacia arriba, reposo correcto, y espolvoreado de un shaker mediano de corn meal; vida útil mínimo de 30 minutos y máximo de 2 horas).' },
      { id: 14, text: 'El colaborador explica que ocurre si realiza un sheetout sobre otro sheetout. (hace que los moldes se expandan y que se hundan unos sobre otros).' },
      { id: 15, text: 'El colaborador realiza una correcta rotación de las torres de sheetouts en el rack de proyección. Y responde a, ¿Cuánto tiempo de vida tienen las torres de sheetouts?. (vida útil mínimo de 30 minutos y máximo de 2 horas).' },
      { id: 16, text: 'El colaborador amasa la bola de masa de 10 oz. Utilizando el método de la \"doble aspa o doble X\". Cuadra la bola de masa y utiliza únicamente los rodillos superiores del sheeter.' },
      { id: 17, text: 'El colaborador enharina ligeramente la tabla de cortar con corn meal, antes de colocar el sheetout encima. El colaborador estira el sheetout con cuidado hasta obtener una forma rectangular; realiza 7 cortes y obtiene 8 piezas regulares de Crazy Bread. Y responde a, ¿Cuánto es el tiempo de vida de los crazy breads?. (vida útil de mínimo 30 minutos y máximo 2 horas).' },
      { id: 18, text: 'Para empezar a hacer Crazy Bread Rellenos, el colaborador ajusta ambos rodillos del sheeter a N° 4.' },
      { id: 19, text: 'Enharina una cantidad mediana de corn meal la tabla de cortar utilzando el shaker.' },
      { id: 20, text: 'El colaborador pasa la masa por ambos rodillos y sobre la tabla le da una forma rectangular hasta obtener un tamaño de 10\" x 8\".' },
      { id: 21, text: 'El colaborador coloca 4 mitades de tiras de queso a la misma distancia en la parte inferior del sheetout.' },
      { id: 22, text: 'El colaborador dobla la parte superior del sheetout hacia abajo encima de las tiras de queso.' },
      { id: 23, text: 'El colaborador usa el sellador-cortador para sellar y cortar alrededor de cada orilla, obteniendo asi 04 piezas individuales.' },
      { id: 24, text: 'El colaborador traslada las 04 piezas selladas a una bandeja de Crazy Bread y usa una brocha para cubrir ligeramente cada pieza con Crazy Bread Spread.' },
      { id: 25, text: 'Para el Crazy Cheese Bread, el colaborador enharina ligeramente la tabla de cortar con corn meal, antes de colocar el sheetout encima. El colaborador estira el sheetout con cuidado hasta obtener una forma rectangular de 7\" x 8\" y posteriormente traslada el sheetout a una bandeja de Crazy Bread.' },
      { id: 26, text: 'Para empezar a hacer los Crazy Pops, el colaborador ajusta ambos rodillos del sheeter a N° 2.5 en ambos rodillos.' },
      { id: 27, text: 'El colaborador toma la temperatura de la masa destinada para la elaboración de Crazy Pops y se asegura de que no supere los 40°F.' },
      { id: 28, text: 'El colaborador prepara el molde para Crazy Pops sumergiendo una brocha en Crazy Bread Spread y la distribuye en las 4 cavidades, cubriendo el fondo y lados de las mismas.' },
      { id: 29, text: 'El colaborador enharina una bola de masa de 10 oz. Utilizando el método de la \"doble aspa o doble X\" para crear un borde blanco y suave.' },
      { id: 30, text: 'El colaborador coloca la masa en el sheeter y la gira 90° para pasarla por los rodillos inferiores.' },
      { id: 31, text: 'El colaborador coloca una cantidad moderada de harina en el inserto blanco para Crazy Pops, y coloca el sheetout con la corteza hacia arriba en el centro.' },
      { id: 32, text: 'El colaborador coloca un aro de preparación gris en el sheetout haciendo que este toque apenas el circulo interior del aro. Luego agrega una cantidad moderada de harina para espolvorear el sheetout.' },
      { id: 33, text: 'El colaborador utiliza el cortador de pops y corta 08 discos iguales comenzando en el centro. Posterior a ello retira el aro de preparación y retira el exceso de masa resultante del corte.' },
      { id: 34, text: 'El colaborador centra los discos con la corteza hacia arriba en cada cavidad del molde para Crazy Pops. Y se asegura que esten a 1/2\" de la parte superior de la cavidad utilizando la herramienta de desempeño.' },
      { id: 35, text: 'Para el sheetout con borde de queso, el colaborador coloca un aro encima de un sheetout redondo y ubica 6 1/3 barras de queso en tiras siguiendo la forma circular del aro.' },
      { id: 36, text: 'El colaborador retira el aro del molde y sigue los procedimiendo de: doble encima, presione para sellar, estire y ajuste al molde.' },
      { id: 37, text: 'El colaborador apila los sheetouts con borde de queso colocando un divisor de plástico teniendo en cuenta que solo debe apilar como máximo 6 de estos. Finalmente le colca un tiempo de retención de 30 minutos.' },
      { id: 38, text: 'El colaborador conoce y controla los tiempos de reposo y vencimiento de los sheetout redondos y de complementos.' }
    ]
  },
  VESTIDO: {
    title: 'Pizza Dress (Vestido)',
    points: [
      { id: 1, text: 'Mantiene su posición y sigue sus proyecciones.' },
      { id: 2, text: 'En caso de que la venta no esté acorde a sus proyecciones, se lo hace saber al responsable del turno para que las aumente o disminuya según corresponda.' },
      { id: 3, text: 'Está constantemente pendiente del vencimiento de sus pizzas en ready rack.' },
      { id: 4, text: 'El colaborador utiliza los sheetouts redondos que cumplen con las características de calidad necesarias.' },
      { id: 5, text: 'El colaborador coloca el aro gris sobre el sheetout elegido.' },
      { id: 6, text: 'El colaborador aplica la cantidad de salsa adecuada, la esparce por el sheetout realizando movimientos circulares. Y responde a la pregunta: ¿Cuánta salsa se debe aplicar y cuál es la distancia que debe existir entre el aro y la salsa? Respuesta: 06oz y 1/4\"' },
      { id: 7, text: 'El colaborador llena la taza de queso N° 8 con la cantidad correcta de queso mozarrella y la distribuye uniformemente en la pizza comenzando desde el borde hacia el centro de la pizza.' },
      { id: 8, text: 'El colaborador coloca de manera correcta los 30 pepperonis utilizando el patrón 6-5-4 para la pizza de peperoni y 5-4-3 para las pizzas de especialidad.' },
      { id: 9, text: 'El colaborador sigue las recetas para la prepración de las diferentes pizzas del menú; utilizando las tazas y cantidades correctas.' },
      { id: 10, text: 'El colaborador llena las tazas de manera manual y según la indicación de la receta de preparación.' },
      { id: 11, text: 'El colaborador retira el aro gris al término de la preparación y coloca la pizza en el ready rack teniendo en cuenta los tiempos de retención.' },
      { id: 12, text: 'El colaborador usa el Square Dough Docker para pinchar el sheetour de Crazy Chesse Bread y le agrega 2 tazas rojas de queso mozarrella distribuyendolo de manera uniforme hasta el borde del producto.' },
      { id: 13, text: 'El colaborador sigue las recetas para el vestido de los Crazy Pops de Pepperoni, Hula Hawaiian y Queso.' },
      { id: 14, text: 'El colaborador cubre cada molde de Crazy Pops con una tapa y marca en la misma su tiempo de vida útil de 6 horas para después colocarlo en la cámara fría.' },
      { id: 15, text: 'El colaborador utiliza de manera correcta los timers de los ready racks teniendo en cuenta que la diferencia de tiempo entre zonas debe ser de 10 minutos como máximo.' },
      { id: 16, text: 'El colaborador inicia el timer del ready rack desde la colocación de la primera pizza en una zona.' },
      { id: 17, text: 'El colaborador utiliza el método PEPS para que las pizzas con mayor tiempo de retención ingresen primero al horno.' }
    ]
  },
  LANDING: {
    title: 'Landing (Pizza / Crazy Bread)',
    points: [
      { id: 1, text: 'Mantiene su posición y sigue sus proyecciones.' },
      { id: 2, text: 'En caso de que la venta no esté acorde a sus proyecciones, se lo hace saber al responsable del turno para que las aumente o disminuya según corresponda.' },
      { id: 3, text: 'Está constantemente pendiente del vencimiento de sus productos en Cres Cor.' },
      { id: 4, text: 'El colaborador utiliza correctamente la pinza sujeta moldes y la espátula de calor para retirar las pizzas del horno. Y responde a ¿Cuál es la importancia de utilizar la espátula de calor? Respuesta: Prolonga la vida útil de la pinza y brinda mayor estabilidad y soporte del molde.' },
      { id: 5, text: 'El colabporador utiliza correctamente el Long Bubble Popper para eliminar burbujas en la pizza. Observe el criterio del colaborador en determinar si la burbuja no afecta la apariencia del producto.' },
      { id: 6, text: 'El colaborador utiliza el cortador del color correcto según el tipo de pizza; rojo para las pizzas con carne y blanco para las pizzas de queso, vegetarianas o que tengan alguna indicación especial.' },
      { id: 7, text: 'El colaborador corta de manera correcta y uniforme una pizza redonda de 14\", siguiendo la secuencia correcta de cortes.' },
      { id: 8, text: 'El colaborador reconoce las características del horneado de calidad de una pizza y de no cumplir con el estandar, la desecha.' },
      { id: 9, text: 'El colaborador marca el tiempo de vencimiento de todos nuestros productos de manera correcta (30 minutos).' },
      { id: 10, text: 'El colaborador explica porqué no es recomendable cortar las pizzas sobre una pila de cajas.' },
      { id: 11, text: 'El colaborador sigue el procedimiento correcto para el corte, preparación y empaque de las pizzas con borde de queso.' },
      { id: 12, text: 'El colaborador reconoce las características del horneado de calidad de los Crazy Breads.' },
      { id: 13, text: 'El colaborador utiliza la espátula negran ancha para transferir los Crazy Breads a la bandeja perforada, colocandolos de manera horizontal.' },
      { id: 14, text: 'El colaborador utiliza 02 brochas para bañar con Crazy Bread Spread el producto de manera uniforme desde el centro hacia las puntas, voltea la brochas y repite el procedimiento para la segunda orden.' },
      { id: 15, text: 'El colaborador choca 02 shakers de queso parmesano entre si para aplicar una capa abundante del insumo sobre toda la superficie de los Crazy Breads.' },
      { id: 16, text: 'El colaborador transfiere los Crazy Breads al papel para envolver utilizando una pinza y los alinea de manera vertical.' },
      { id: 17, text: 'El colaborador pliega, enrrolla, embolsa y marca de manera correcta los Crazy Breads.' },
      { id: 18, text: 'Para las Cinnamon Stix (Canelitas), el colaborador utiliza la espátula negran ancha para transferir el producto a la bandeja perforada, colocandolos de manera horizontal.' },
      { id: 19, text: 'El colaborador utiliza 01 brocha para aplicar una capa uniforme de margarina líquida de punta a punta en los Cinnamon Stix (Canelitas).' },
      { id: 20, text: 'El colaborador esparce una porción abundante de mezcla de azúcar con canela cubriendo completamente las Cinnamon Stix (Canelitas) de punta a punta.' },
      { id: 21, text: 'El colaborador transfiere las Cinnamon Stix (Canelitas) al papel para envolver utilizando una pinza y las alinea de manera vertical.' },
      { id: 22, text: 'El colaborador pliega, enrrolla, embolsa y marca de manera correcta las Cinnamon Stix (Canelitas).' },
      { id: 23, text: 'El colaborador utiliza la pinza y espatula negra de calor para colocar los Crazy Chesse Bread directamente en su caja.' },
      { id: 24, text: 'El colaborador aplica de manera uniforme Crazy Bread Spread en toda el área del Crazy Chesse Bread usando una brocha.' },
      { id: 25, text: 'El colaborador realiza la secuencia correcta de cortes para obtener 12 piezas del Crazy Chesse Bread.' },
      { id: 26, text: 'El colaborador aplica una cantidad abundante de queso parmesano en el Crazy Chesse Bread.' },
      { id: 27, text: 'El colaborador empaqueta y marca el Crazy Chesse Bread de manera correcta.' },
      { id: 28, text: 'El colaborador transfiere los Crazy Bread Rellenos a la bandeja perforada utilizando una pinza sujeta moldes y una espátula negra de calor.' },
      { id: 29, text: 'El colaborador aplica una capa liviana de Crazy Bread Spread a cada pieza de Crazy Bread Relleno con 01 brocha.' },
      { id: 30, text: 'El colaborador aplica una capa gruesa de queso parmesano a cada pieza de Crazy Bread Rellenos.' },
      { id: 31, text: 'El colaborador pliega, enrrolla, embolsa y marca de manera correcta los Crazy Bread Rellenos.' },
      { id: 32, text: 'El colaborador prepara la caja y el papel correctamente para envolver de Crazy Pops.' },
      { id: 33, text: 'El colaborador utiliza la pinza sujeta moldes y la espátula negra de calor de forma invertida para sacar los moldes del horno.' },
      { id: 34, text: 'El colabotador rocia 01 línea de Crazy Bread Spread en forma de \"zigzag\" por cada Crazy Pop.' },
      { id: 35, text: 'El colaborador aplica una porción de veggie seasoning por cada Crazy Pop de acuerdo a la ayuda visual.' },
      { id: 36, text: 'El colaborador utiliza una pinza para transferir cada Crazy Pop a una caja previamente preparada y sin dañar el producto.' },
      { id: 37, text: 'El colaborador empaqueta y marca el producto de manera correcta.' },
      { id: 38, text: 'El colaborador reconoce la distribución de productos en los Cres Cor e identifica cuando un producto ya está vencido.' }
    ]
  },
  LAVADO: {
    title: 'Lavado de Utensilios',
    points: [
      { id: 1, text: 'El colaborador prepara de manera correcta la tarja triple para la jornada laboral, teniendo en cuenta las temperaturas y cantidad de agua correctas.' },
      { id: 2, text: 'El colaborador conoce la preparación de las soluciones de las tarjas de lavado.' },
      { id: 3, text: 'El colaborador utiliza el CLORITEST para medir la concentación del sanitizante en la tarja (100 ppm).' },
      { id: 4, text: 'El colaborador conoce, demuestra y explica el procedimiento correcto para el lavado y secado de los utensilios.' },
      { id: 5, text: 'El colaborador explica por cuánto tiempo deben permanecer sumergidos los utensilios en la tarja jabonosa (mínimo 5 minutos para facilitar la eliminación de la grasa en el utensilio) y en la tarja con sanitizante. (mínimo 1 minuto para que el sanitizante sea eficaz).' },
      { id: 6, text: 'El colaborador explica la razón por la cual siempre se debe utilizar una alfombrilla en esta estación (evitar resbalones y/o accidentes).' },
      { id: 7, text: 'El colaborador explica con qué frecuencia se debe cambiar las pozas de la tarja triple.' },
      { id: 8, text: 'El colaborador demuestra y explica como preparar los baldes verdes y rojos para cada estación, asi como la frecuencia del cambio de los mismos.' },
      { id: 9, text: 'El colaborador conoce la programación de saneamiento y limpieza de utensilios y equipos del restaurante.' }
    ]
  }
};

export const KNOWLEDGE_POINTS = [
  { id: 18, text: 'Describa cómo respondería a las siguientes peticiones y/o preguntas del invitado:\n- Modificar productos del menú.\n- Diferencia de precios con otras sedes.\n- Agregar y/o quitar ingredientes de los productos.' },
  { id: 19, text: 'De tres ejemplos de reclamos o quejas de invitados y explique como aplicar el proceso de solución de quejas.' },
  { id: 20, text: 'Describa que hacer si un invitado pide más óregano, ají y servilletas.' },
  { id: 21, text: 'Demostrar cómo determinar los niveles de proyecciones Build-To.' },
  { id: 22, text: 'Demostrar cómo y por qué comunicamos los niveles al vender productos HOT-N-READY.' },
  { id: 23, text: 'Demostrar como vender sugestivamente los siguientes productos:\n- Crazy Pops.\n- Crazy Bread.\n- Cinnamon Stix (Canelitas).\n- Dips.\n- Gaseosas' },
  { id: 24, text: 'Explicar lo que significa \"Dos en fila es demasiada fila\" (Two Deep is Too Deep).' }
];
