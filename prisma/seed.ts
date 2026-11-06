/* Datos de demostración realistas para ITSM Easy. Ejecutar: npm run db:seed */
import { PrismaClient, type Level, type Priority, type TicketStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { addBusinessMinutes, type CalendarLike } from "../src/lib/sla-calc";
import { priorityMatrix } from "../src/lib/classify";
import { encrypt } from "../src/lib/crypto";

const db = new PrismaClient();
const PASSWORD = "Demo12345!";

// PRNG determinista para que la demo sea reproducible
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
const chance = (p: number) => rand() < p;

async function main() {
  if (process.env.SEED_IF_EMPTY === "1" && (await db.organization.count()) > 0) {
    console.log("✔ La base de datos ya tiene datos: se omite la carga de demostración.");
    return;
  }
  console.log("→ Limpiando base de datos…");
  await db.auditLog.deleteMany();
  await db.notification.deleteMany();
  await db.organization.deleteMany();
  await db.user.deleteMany();

  const hash = await bcrypt.hash(PASSWORD, 12);

  // ------------------------------------------------------------ Superadmin SaaS
  await db.user.create({ data: { email: "root@itsmeasy.app", name: "Operaciones ITSM Easy", passwordHash: hash, role: "SUPER_ADMIN" } });

  // ------------------------------------------------------------ Org demo
  const org = await db.organization.create({ data: { name: "Andes Logística", slug: "andes", plan: "business", timezone: "America/Santiago" } });
  const O = org.id;

  const deptNames = ["Finanzas", "Operaciones", "Comercial", "Recursos Humanos", "Tecnología", "Gerencia"];
  const depts: Record<string, string> = {};
  for (const n of deptNames) depts[n] = (await db.department.create({ data: { orgId: O, name: n } })).id;

  const mk = (email: string, name: string, role: any, dept: string, title: string, managerId?: string) =>
    db.user.create({ data: { orgId: O, email, name, role, passwordHash: hash, departmentId: depts[dept], title, managerId } });

  const admin = await mk("admin@andes.demo", "Valentina Rojas", "ORG_ADMIN", "Tecnología", "Jefa de TI");
  const manager = await mk("gestor@andes.demo", "Martín Fuentes", "SERVICE_MANAGER", "Tecnología", "Service Manager", admin.id);
  const agents = [
    await mk("camila@andes.demo", "Camila Soto", "AGENT", "Tecnología", "Analista de soporte N1", manager.id),
    await mk("diego@andes.demo", "Diego Muñoz", "AGENT", "Tecnología", "Analista de soporte N1", manager.id),
    await mk("javiera@andes.demo", "Javiera Pérez", "AGENT", "Tecnología", "Ingeniera de infraestructura", manager.id),
    await mk("tomas@andes.demo", "Tomás Herrera", "AGENT", "Tecnología", "Especialista en aplicaciones", manager.id),
  ];
  const [camila, diego, javiera, tomas] = agents;
  const approver = await mk("patricia@andes.demo", "Patricia Lagos", "APPROVER", "Finanzas", "Gerenta de Finanzas");
  const opsBoss = await mk("rodrigo@andes.demo", "Rodrigo Vidal", "APPROVER", "Operaciones", "Gerente de Operaciones");
  const users = [
    await mk("ana@andes.demo", "Ana Torres", "END_USER", "Finanzas", "Analista contable", approver.id),
    await mk("luis@andes.demo", "Luis Contreras", "END_USER", "Operaciones", "Coordinador de bodega", opsBoss.id),
    await mk("sofia@andes.demo", "Sofía Medina", "END_USER", "Comercial", "Ejecutiva comercial", approver.id),
    await mk("pablo@andes.demo", "Pablo Reyes", "END_USER", "Operaciones", "Supervisor de despacho", opsBoss.id),
    await mk("carla@andes.demo", "Carla Navarro", "END_USER", "Recursos Humanos", "Analista de personas", approver.id),
    await mk("ignacio@andes.demo", "Ignacio Castro", "END_USER", "Comercial", "Key account manager", approver.id),
    await mk("fernanda@andes.demo", "Fernanda Silva", "END_USER", "Finanzas", "Tesorera", approver.id),
    await mk("matias@andes.demo", "Matías Araya", "END_USER", "Operaciones", "Jefe de turno", opsBoss.id),
  ];
  const ana = users[0]!;

  // Equipos
  const team = async (name: string, description: string, members: { u: { id: string }; lead?: boolean }[]) =>
    db.team.create({ data: { orgId: O, name, description, members: { create: members.map((m) => ({ userId: m.u.id, isLead: !!m.lead })) } } });
  const tHelp = await team("Mesa de ayuda", "Primer nivel: atención general y accesos", [{ u: camila!, lead: true }, { u: diego! }, { u: manager }]);
  const tInfra = await team("Infraestructura y redes", "Servidores, redes, VPN y equipos", [{ u: javiera!, lead: true }, { u: diego! }]);
  const tApps = await team("Aplicaciones de negocio", "ERP, CRM y software corporativo", [{ u: tomas!, lead: true }, { u: camila! }]);

  // Categorías con palabras clave (clasificación automática)
  const cat = async (name: string, icon: string, teamId: string, keywords: string[]) =>
    db.category.create({ data: { orgId: O, name, icon, teamId, keywords } });
  const cMail = await cat("Correo y Office", "mail", tHelp.id, ["correo", "outlook", "email", "excel", "word", "office", "teams", "calendario", "onedrive", "buzon"]);
  const cNet = await cat("Red e Internet", "wifi", tInfra.id, ["internet", "wifi", "red", "vpn", "conexion", "lento", "sin conexion", "cable", "navegar"]);
  const cHw = await cat("Equipos y hardware", "laptop", tInfra.id, ["notebook", "computador", "pantalla", "monitor", "teclado", "mouse", "bateria", "no enciende", "cargador", "equipo"]);
  const cPrint = await cat("Impresoras", "printer", tHelp.id, ["impresora", "imprimir", "escaner", "toner", "papel atascado"]);
  const cAccess = await cat("Accesos y contraseñas", "key-round", tHelp.id, ["contraseña", "clave", "bloqueado", "acceso", "permiso", "usuario", "login", "iniciar sesion", "mfa"]);
  const cApps = await cat("Aplicaciones de negocio", "app-window", tApps.id, ["sap", "erp", "crm", "salesforce", "facturacion", "factura", "sistema de bodega", "wms", "aplicacion", "reporte"]);
  const cPhone = await cat("Telefonía y celulares", "smartphone", tHelp.id, ["telefono", "celular", "anexo", "llamadas", "whatsapp"]);
  const categories = [cMail, cNet, cHw, cPrint, cAccess, cApps, cPhone];

  // Calendarios y SLA
  const holidays2026 = [
    ["2026-01-01", "Año Nuevo"], ["2026-04-03", "Viernes Santo"], ["2026-04-04", "Sábado Santo"], ["2026-05-01", "Día del Trabajo"],
    ["2026-05-21", "Glorias Navales"], ["2026-06-21", "Pueblos Indígenas"], ["2026-06-29", "San Pedro y San Pablo"], ["2026-07-16", "Virgen del Carmen"],
    ["2026-08-15", "Asunción de la Virgen"], ["2026-09-18", "Independencia Nacional"], ["2026-09-19", "Glorias del Ejército"],
    ["2026-10-12", "Encuentro de Dos Mundos"], ["2026-10-31", "Iglesias Evangélicas"], ["2026-11-01", "Todos los Santos"],
    ["2026-12-08", "Inmaculada Concepción"], ["2026-12-25", "Navidad"],
  ];
  const office = await db.businessCalendar.create({
    data: {
      orgId: O, name: "Oficina Santiago (L-V 09:00-18:00)", timezone: "America/Santiago", workDays: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "18:00",
      holidays: { create: holidays2026.map(([date, name]) => ({ date: date!, name: name! })) },
    },
  });
  const always = await db.businessCalendar.create({ data: { orgId: O, name: "24x7", timezone: "America/Santiago", workDays: [0, 1, 2, 3, 4, 5, 6], is24x7: true } });
  const officeCal: CalendarLike = { timezone: "America/Santiago", workDays: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "18:00", is24x7: false, holidays: holidays2026.map((h) => h[0]!) };
  const policies = {
    P1: await db.slaPolicy.create({ data: { orgId: O, priority: "P1", name: "Crítica — 24x7", responseMinutes: 15, resolutionMinutes: 240, calendarId: always.id } }),
    P2: await db.slaPolicy.create({ data: { orgId: O, priority: "P2", name: "Alta", responseMinutes: 60, resolutionMinutes: 480, calendarId: office.id } }),
    P3: await db.slaPolicy.create({ data: { orgId: O, priority: "P3", name: "Media", responseMinutes: 240, resolutionMinutes: 1440, calendarId: office.id } }),
    P4: await db.slaPolicy.create({ data: { orgId: O, priority: "P4", name: "Baja", responseMinutes: 480, resolutionMinutes: 2700, calendarId: office.id } }),
  };
  const calFor = (p: Priority) => (p === "P1" ? null : officeCal);

  // Catálogo de servicios
  const svc = (data: any) => db.serviceItem.create({ data: { orgId: O, ...data } });
  const sNotebook = await svc({
    name: "Solicitar un notebook", icon: "laptop", categoryId: cHw.id, ownerTeamId: tInfra.id, ownerId: javiera!.id, estimatedHours: 72,
    description: "Equipo nuevo para colaboradores que ingresan o renovación por falla u obsolescencia.",
    requirements: "Aprobación de tu jefatura directa. Si es renovación, entrega el equipo anterior.",
    requiresApproval: true, approvalMode: "MANAGER", defaultPriority: "P3",
    formSchema: [
      { key: "modelo", label: "¿Qué tipo de equipo necesitas?", type: "select", required: true, options: ["Estándar (oficina)", "Avanzado (análisis de datos / diseño)", "Liviano (viajes frecuentes)"] },
      { key: "motivo", label: "Motivo", type: "select", required: true, options: ["Nuevo ingreso", "Equipo con falla", "Equipo antiguo / lento", "Otro"] },
      { key: "fecha", label: "¿Para cuándo lo necesitas?", type: "date", required: false },
    ],
  });
  const sSoftware = await svc({
    name: "Instalar un programa", icon: "download", categoryId: cApps.id, ownerTeamId: tHelp.id, estimatedHours: 8,
    description: "Instalación de software licenciado o gratuito aprobado por TI en tu equipo.",
    requirements: "El programa debe estar en la lista de software aprobado.",
    defaultPriority: "P4",
    formSchema: [
      { key: "programa", label: "¿Qué programa necesitas?", type: "select", required: true, options: ["Adobe Acrobat Pro", "Power BI Desktop", "Visual Studio Code", "Zoom", "AutoCAD LT", "Otro"] },
      { key: "detalle", label: "Si elegiste «Otro», indica cuál", type: "text", required: false },
    ],
  });
  const sNewUser = await svc({
    name: "Alta de nuevo colaborador", icon: "user-plus", categoryId: cAccess.id, ownerTeamId: tHelp.id, ownerId: camila!.id, estimatedHours: 24,
    description: "Crea la cuenta, el correo y los accesos básicos para una persona que se incorpora.",
    requirements: "Solicitar con al menos 2 días hábiles de anticipación.",
    requiresApproval: true, approvalMode: "USER", approverId: admin.id, defaultPriority: "P3",
    formSchema: [
      { key: "nombre", label: "Nombre completo", type: "text", required: true },
      { key: "rut", label: "RUT", type: "text", required: true, sensitive: true, placeholder: "12.345.678-9" },
      { key: "cargo", label: "Cargo", type: "text", required: true },
      { key: "area", label: "Área", type: "select", required: true, options: deptNames },
      { key: "ingreso", label: "Fecha de ingreso", type: "date", required: true },
    ],
  });
  const sPassword = await svc({
    name: "Restablecer mi contraseña", icon: "key-round", categoryId: cAccess.id, ownerTeamId: tHelp.id, estimatedHours: 1,
    description: "¿Olvidaste tu clave o quedó bloqueada? Te ayudamos a recuperarla.",
    defaultPriority: "P2",
    formSchema: [{ key: "sistema", label: "¿De qué sistema?", type: "select", required: true, options: ["Windows / correo", "SAP", "Salesforce", "VPN", "Otro"] }],
  });
  const sAccess = await svc({
    name: "Acceso a un sistema", icon: "shield-check", categoryId: cAccess.id, ownerTeamId: tApps.id, ownerId: tomas!.id, estimatedHours: 16,
    description: "Solicita acceso a SAP, Salesforce, WMS u otro sistema corporativo.",
    requirements: "Requiere aprobación de tu jefatura.",
    requiresApproval: true, approvalMode: "MANAGER", defaultPriority: "P3",
    formSchema: [
      { key: "sistema", label: "Sistema", type: "select", required: true, options: ["SAP", "Salesforce", "WMS (bodega)", "Power BI", "Portal de proveedores"] },
      { key: "perfil", label: "Tipo de acceso", type: "select", required: true, options: ["Solo lectura", "Edición", "Administrador"] },
      { key: "justificacion", label: "¿Para qué lo necesitas?", type: "textarea", required: true },
    ],
  });
  const sFolder = await svc({
    name: "Permiso a carpeta compartida", icon: "folder-lock", categoryId: cAccess.id, ownerTeamId: tHelp.id, estimatedHours: 8,
    description: "Acceso a carpetas de red o sitios de SharePoint de otras áreas.",
    requiresApproval: true, approvalMode: "MANAGER", defaultPriority: "P4",
    formSchema: [
      { key: "carpeta", label: "Nombre o ruta de la carpeta", type: "text", required: true, placeholder: "\\\\servidor\\finanzas\\2026" },
      { key: "permiso", label: "Permiso", type: "select", required: true, options: ["Lectura", "Lectura y escritura"] },
    ],
  });
  const sPeripheral = await svc({
    name: "Accesorios y periféricos", icon: "mouse", categoryId: cHw.id, ownerTeamId: tInfra.id, estimatedHours: 24,
    description: "Monitor, teclado, mouse, audífonos, cargador o adaptadores.",
    defaultPriority: "P4",
    formSchema: [
      { key: "recurso", label: "¿Qué necesitas?", type: "select", required: true, options: ["Monitor adicional", "Teclado y mouse", "Audífonos con micrófono", "Cargador", "Adaptador USB-C / HDMI"] },
      { key: "cantidad", label: "Cantidad", type: "number", required: false },
    ],
  });
  const sVpn = await svc({
    name: "Acceso VPN para teletrabajo", icon: "globe-lock", categoryId: cNet.id, ownerTeamId: tInfra.id, estimatedHours: 8,
    description: "Conéctate de forma segura a la red de la empresa desde tu casa.",
    requiresApproval: true, approvalMode: "MANAGER", defaultPriority: "P3",
    formSchema: [{ key: "dias", label: "¿Qué días trabajarás remoto?", type: "text", required: true, placeholder: "Ej: martes y jueves" }],
  });
  const services = [sNotebook, sSoftware, sNewUser, sPassword, sAccess, sFolder, sPeripheral, sVpn];

  // Base de conocimientos
  const kb = (title: string, slug: string, summary: string, body: string, categoryId: string, tags: string[], isFaq = false, views = 0, yes = 0, no = 0) =>
    db.kbArticle.create({ data: { orgId: O, title, slug, summary, body, categoryId, tags, isFaq, views, helpfulYes: yes, helpfulNo: no, authorId: camila!.id } });
  await kb("Cómo restablecer tu contraseña de Windows y correo", "restablecer-contrasena", "Recupera tu acceso en 2 minutos desde el portal de autoservicio de Microsoft.",
    "Si olvidaste tu contraseña o tu cuenta quedó bloqueada, sigue estos pasos:\n\n1. Desde tu celular o cualquier navegador, abre https://passwordreset.microsoftonline.com\n2. Ingresa tu correo corporativo y el código que aparece en pantalla.\n3. Verifica tu identidad con el código que llega a tu celular registrado.\n4. Crea una contraseña nueva de al menos 10 caracteres, con letras y números.\n5. Espera 5 minutos y vuelve a iniciar sesión en tu equipo.\n\nSi no tienes un celular registrado, solicita «Restablecer mi contraseña» en el catálogo y te ayudamos.",
    cAccess.id, ["contraseña", "clave", "bloqueado", "password"], false, 412, 88, 4);
  await kb("Conectarse a la VPN desde casa", "conectarse-vpn", "Pasos para usar FortiClient y trabajar con los sistemas internos de forma segura.",
    "1. Abre FortiClient VPN desde el menú Inicio.\n2. Selecciona la conexión «Andes-Remoto».\n3. Ingresa tu usuario (sin @andes.demo) y contraseña.\n4. Aprueba la notificación en Microsoft Authenticator.\n5. Cuando el ícono se ponga verde, ya estás conectado.\n\nSi te aparece «Credenciales inválidas», revisa que tu cuenta tenga acceso VPN habilitado. Si no lo tienes, solicita «Acceso VPN para teletrabajo».",
    cNet.id, ["vpn", "teletrabajo", "remoto", "forticlient", "conexion"], false, 260, 51, 6);
  await kb("La impresora no imprime o quedó en cola", "impresora-no-imprime", "Soluciones rápidas para trabajos atascados en la cola de impresión.",
    "1. Verifica que la impresora esté encendida y sin luces de error.\n2. Revisa que tenga papel y que no haya papel atascado.\n3. En tu equipo, abre Configuración > Impresoras y elimina los trabajos en cola.\n4. Apaga y enciende la impresora (espera 30 segundos).\n5. Vuelve a enviar el documento.\n\nSi la impresora muestra «Tóner bajo», avísanos creando un reporte en la categoría Impresoras.",
    cPrint.id, ["impresora", "imprimir", "cola", "toner"], false, 198, 40, 9);
  await kb("Configurar el correo corporativo en tu celular", "correo-en-celular", "Instala Outlook en iOS o Android y accede a tu correo y calendario.",
    "1. Descarga Microsoft Outlook desde App Store o Google Play.\n2. Abre la app y escribe tu correo corporativo.\n3. Ingresa tu contraseña y aprueba el inicio de sesión en Authenticator.\n4. Acepta la política de seguridad de la empresa (Intune).\n5. ¡Listo! Tu correo, contactos y calendario se sincronizarán.",
    cMail.id, ["correo", "outlook", "celular", "movil"], false, 155, 33, 2);
  await kb("Wi-Fi lento o sin conexión en la oficina", "wifi-lento", "Qué revisar antes de reportar problemas de red.",
    "1. Confirma que estás conectado a la red «Andes-Corp» y no a «Andes-Invitados».\n2. Desactiva y vuelve a activar el Wi-Fi de tu equipo.\n3. Acércate a un punto de acceso o prueba con cable de red.\n4. Si tus compañeros también tienen el problema, repórtalo indicando que afecta a tu área: lo atenderemos con mayor prioridad.",
    cNet.id, ["wifi", "internet", "lento", "red", "conexion"], false, 301, 47, 15);
  await kb("Teams sin audio o micrófono en reuniones", "teams-sin-audio", "Revisa los dispositivos de audio de Microsoft Teams.",
    "1. En Teams, haz clic en tu foto > Configuración > Dispositivos.\n2. Selecciona tus audífonos tanto en «Altavoz» como en «Micrófono».\n3. Usa «Realizar una llamada de prueba».\n4. Si no aparece tu dispositivo, desconéctalo y vuelve a conectarlo.\n5. Reinicia Teams completamente (clic derecho en el ícono > Salir).",
    cMail.id, ["teams", "audio", "microfono", "reunion"], false, 140, 29, 3);
  await kb("SAP: error «Usuario bloqueado» al iniciar sesión", "sap-usuario-bloqueado", "Qué hacer si SAP bloquea tu usuario tras varios intentos.",
    "1. Espera 15 minutos: el bloqueo por intentos fallidos se libera automáticamente.\n2. Si necesitas acceso urgente, solicita «Restablecer mi contraseña» y elige SAP.\n3. Nunca compartas tu usuario de SAP: cada acción queda registrada a tu nombre.",
    cApps.id, ["sap", "bloqueado", "erp", "contraseña"], false, 95, 20, 1);
  await kb("¿Cuánto se demora mi solicitud?", "cuanto-demora", "Tiempos estimados de atención según la urgencia.",
    "Cada servicio del catálogo muestra un tiempo estimado. Como referencia:\n\n- Crítica (no puede trabajar toda un área): respuesta en 15 minutos, 24x7.\n- Alta: respuesta en 1 hora hábil.\n- Media: respuesta en 4 horas hábiles.\n- Baja: respuesta en 1 día hábil.\n\nLas solicitudes que requieren aprobación comienzan a contar cuando tu jefatura aprueba.",
    cAccess.id, ["tiempo", "demora", "sla", "plazo"], true, 220, 61, 5);
  await kb("¿Cómo veo el estado de mi solicitud?", "estado-solicitud", "Sigue tus solicitudes en tiempo real desde «Mis solicitudes».",
    "1. Entra a «Mis solicitudes» en el menú.\n2. Verás cada solicitud con su estado: Recibido, Trabajando en ello, Esperando información o Solucionado.\n3. Haz clic en una solicitud para conversar con el equipo de soporte.\n4. Te avisaremos con una notificación cada vez que haya novedades.",
    cAccess.id, ["estado", "seguimiento", "solicitud"], true, 180, 44, 1);
  await kb("¿Qué hago si mi problema afecta a toda el área?", "problema-masivo", "Cómo reportar fallas que afectan a varias personas.",
    "Al crear tu reporte, en la pregunta «¿A quién afecta?» elige «A mi equipo o área» o «A toda la empresa». Así el equipo de TI lo atenderá con mayor prioridad. No es necesario que cada persona cree su propio reporte: pueden comentar en el mismo.",
    cNet.id, ["masivo", "todos", "prioridad", "caida"], true, 75, 18, 0);

  // ------------------------------------------------------------ Tickets
  console.log("→ Generando tickets de demostración…");
  const incidentTemplates: [string, string, typeof categories[number], Level, Level][] = [
    ["No puedo abrir Outlook, se queda cargando", "Desde esta mañana Outlook se queda en «Cargando perfil» y no abre.", cMail, "LOW", "MEDIUM"],
    ["Internet muy lento en el segundo piso", "Todo el equipo comercial del segundo piso tiene internet muy lento desde las 10:00.", cNet, "MEDIUM", "MEDIUM"],
    ["La impresora de Finanzas no imprime", "La impresora HP del área de Finanzas muestra papel atascado pero no hay papel.", cPrint, "MEDIUM", "LOW"],
    ["SAP no deja contabilizar facturas", "Al contabilizar facturas en SAP aparece el error «período cerrado». Estamos en cierre de mes.", cApps, "MEDIUM", "HIGH"],
    ["Mi notebook no enciende", "El notebook no enciende aunque está conectado al cargador. No puedo trabajar.", cHw, "LOW", "HIGH"],
    ["No me funciona la VPN desde casa", "FortiClient dice «credenciales inválidas» aunque mi clave funciona en el correo.", cNet, "LOW", "MEDIUM"],
    ["Teams no tiene audio en las reuniones", "Nadie me escucha en las reuniones de Teams, el micrófono parece no funcionar.", cMail, "LOW", "MEDIUM"],
    ["Cuenta bloqueada, no puedo iniciar sesión", "Ingresé mal la contraseña varias veces y ahora mi cuenta está bloqueada.", cAccess, "LOW", "HIGH"],
    ["El sistema de bodega WMS está caído", "Nadie en bodega puede registrar despachos, el WMS no responde. Los camiones están esperando.", cApps, "HIGH", "HIGH"],
    ["Excel se cierra solo al abrir archivos grandes", "Cuando abro el reporte de ventas Excel se cierra sin mensaje.", cMail, "LOW", "LOW"],
    ["Pantalla del monitor parpadea", "El monitor externo parpadea cada pocos segundos.", cHw, "LOW", "LOW"],
    ["Salesforce muy lento para cargar oportunidades", "Todo el equipo comercial reporta lentitud al cargar oportunidades en Salesforce.", cApps, "MEDIUM", "MEDIUM"],
    ["No recibo correos externos", "Desde ayer no me llegan correos de clientes, solo internos.", cMail, "LOW", "HIGH"],
    ["Wi-Fi se desconecta en sala de reuniones", "En la sala Aconcagua el Wi-Fi se corta durante las reuniones.", cNet, "MEDIUM", "LOW"],
    ["Mi anexo telefónico no tiene tono", "El teléfono de escritorio no tiene tono desde el cambio de puesto.", cPhone, "LOW", "LOW"],
    ["Reporte de facturación no se genera", "El reporte mensual de facturación en SAP da error de tiempo de espera.", cApps, "MEDIUM", "MEDIUM"],
    ["Escáner no envía al correo", "El escáner del primer piso no envía los documentos escaneados al correo.", cPrint, "LOW", "LOW"],
    ["Sin internet en toda la oficina de Antofagasta", "Toda la sucursal de Antofagasta está sin conexión a internet ni a sistemas.", cNet, "HIGH", "HIGH"],
  ];
  const requesters = [...users, approver, opsBoss];
  const now = Date.now();
  const comments = [
    "Hola, ya estoy revisando tu caso. Te aviso en cuanto tenga novedades.",
    "¿Podrías indicarme desde qué hora ocurre y si aparece algún mensaje de error?",
    "Aplicamos una corrección. ¿Puedes confirmar si ya funciona?",
    "Gracias por la información, con eso puedo avanzar.",
  ];
  const resolutions = [
    "Se reinició el servicio y se limpió la caché del perfil. Funcionando correctamente.",
    "Se reemplazó el cargador defectuoso. Equipo operativo.",
    "Se desbloqueó la cuenta y se guió al usuario en el cambio de contraseña.",
    "Se reconfiguró el punto de acceso Wi-Fi y se actualizó el firmware.",
    "Se corrigió la configuración del perfil y se validó con el usuario.",
  ];

  let number = 1000;
  const makeTicket = async (opts: {
    type: "INCIDENT" | "REQUEST"; title: string; description: string; categoryId: string | null; teamId: string | null;
    impact: Level; urgency: Level; priority: Priority; requesterId: string; serviceItemId?: string; formData?: Record<string, string>;
    daysAgo: number; forceStatus?: TicketStatus; approval?: { approverId: string; status: "PENDING" | "APPROVED" | "REJECTED" };
  }) => {
    number++;
    const createdAt = new Date(now - opts.daysAgo * 86400_000 - Math.floor(rand() * 8) * 3600_000);
    const pol = policies[opts.priority];
    const responseDueAt = addBusinessMinutes(createdAt, pol.responseMinutes, calFor(opts.priority));
    const resolutionDueAt = addBusinessMinutes(createdAt, pol.resolutionMinutes, calFor(opts.priority));
    const teamMembers = opts.teamId === tInfra.id ? [javiera!, diego!] : opts.teamId === tApps.id ? [tomas!, camila!] : [camila!, diego!];
    let status: TicketStatus = opts.forceStatus ?? (opts.daysAgo > 3 ? (chance(0.8) ? "CLOSED" : "RESOLVED") : pick(["NEW", "ASSIGNED", "IN_PROGRESS", "IN_PROGRESS", "PENDING", "RESOLVED"] as const));
    if (opts.approval?.status === "PENDING") status = "PENDING";
    if (opts.approval?.status === "REJECTED") status = "CLOSED";
    const assignee = status === "NEW" || opts.approval?.status === "PENDING" || opts.approval?.status === "REJECTED" ? null : pick(teamMembers);
    const done = status === "RESOLVED" || status === "CLOSED";
    const breach = chance(0.13);
    const respMin = Math.max(3, Math.round(pol.responseMinutes * (breach ? 1.4 : 0.2 + rand() * 0.6)));
    const firstResponseAt = assignee && status !== "ASSIGNED" ? new Date(createdAt.getTime() + respMin * 60000) : null;
    const resolvedAt = done && opts.approval?.status !== "REJECTED"
      ? (breach ? new Date(resolutionDueAt.getTime() + (1 + rand() * 10) * 3600_000) : new Date(createdAt.getTime() + (resolutionDueAt.getTime() - createdAt.getTime()) * (0.1 + rand() * 0.75)))
      : null;
    const safeResolvedAt = resolvedAt && resolvedAt.getTime() > now ? new Date(now - 3600_000) : resolvedAt;
    const openBreached = !done && resolutionDueAt.getTime() < now;
    const csat = status === "CLOSED" && safeResolvedAt && chance(0.65) ? (breach ? pick([2, 3, 4]) : pick([4, 5, 5, 5, 4, 3])) : null;
    const t = await db.ticket.create({
      data: {
        orgId: O, number, type: opts.type, title: opts.title, description: opts.description,
        status, impact: opts.impact, urgency: opts.urgency, priority: opts.priority, categoryId: opts.categoryId, teamId: opts.teamId,
        serviceItemId: opts.serviceItemId, formData: opts.formData, requesterId: opts.requesterId, assigneeId: assignee?.id ?? null,
        pendingReason: status === "PENDING" ? (opts.approval?.status === "PENDING" ? "Esperando aprobación" : pick(["Esperando respuesta del usuario", "Esperando proveedor", "Esperando repuesto o equipo"])) : null,
        approvalStatus: opts.approval?.status ?? "NOT_REQUIRED",
        slaPolicyId: pol.id, responseDueAt, resolutionDueAt, firstResponseAt,
        slaPausedAt: status === "PENDING" ? new Date(now - 2 * 3600_000) : null,
        responseBreached: (!!firstResponseAt && firstResponseAt > responseDueAt) || (!firstResponseAt && !done && responseDueAt.getTime() < now),
        resolutionBreached: (!!safeResolvedAt && safeResolvedAt > resolutionDueAt) || (openBreached && status !== "PENDING"),
        slaWarned: !done && status !== "PENDING" && (resolutionDueAt.getTime() - now) / (resolutionDueAt.getTime() - createdAt.getTime()) < 0.25,
        escalationLevel: openBreached && status !== "PENDING" ? 1 : 0,
        resolution: safeResolvedAt ? pick(resolutions) : opts.approval?.status === "REJECTED" ? "Rechazada: no corresponde a las funciones del cargo." : null,
        resolvedAt: safeResolvedAt, closedAt: status === "CLOSED" ? new Date((safeResolvedAt ?? createdAt).getTime() + 86400_000 * 0.5) : null,
        csatScore: csat, csatComment: csat && csat >= 5 && chance(0.4) ? pick(["¡Muy rápido, gracias!", "Excelente atención de Camila.", "Resolvieron todo en minutos."]) : csat && csat <= 2 ? "Demoró demasiado." : null,
        reopenCount: chance(0.05) ? 1 : 0,
        createdAt, updatedAt: safeResolvedAt ?? firstResponseAt ?? createdAt,
      },
    });
    await db.ticketActivity.create({ data: { ticketId: t.id, actorId: opts.requesterId, action: "created", createdAt } });
    if (assignee) await db.ticketActivity.create({ data: { ticketId: t.id, action: "assigned", toValue: assignee.name, note: "Asignación automática por carga de trabajo", createdAt: new Date(createdAt.getTime() + 1000) } });
    if (opts.approval) {
      await db.approval.create({ data: { ticketId: t.id, approverId: opts.approval.approverId, status: opts.approval.status, decidedAt: opts.approval.status === "PENDING" ? null : new Date(createdAt.getTime() + 3600_000), comment: opts.approval.status === "REJECTED" ? "No corresponde a las funciones del cargo." : null, createdAt } });
      await db.ticketActivity.create({ data: { ticketId: t.id, action: "approval", toValue: opts.approval.status === "PENDING" ? "PENDING" : opts.approval.status, createdAt: new Date(createdAt.getTime() + 2000) } });
    }
    if (firstResponseAt) {
      await db.ticketComment.create({ data: { ticketId: t.id, authorId: assignee!.id, body: pick(comments), createdAt: firstResponseAt } });
      if (status !== "ASSIGNED") await db.ticketActivity.create({ data: { ticketId: t.id, actorId: assignee!.id, action: "status", fromValue: "ASSIGNED", toValue: "IN_PROGRESS", createdAt: firstResponseAt } });
      if (chance(0.3)) await db.ticketComment.create({ data: { ticketId: t.id, authorId: assignee!.id, isInternal: true, body: "Nota interna: revisar si se repite en otros equipos del área.", createdAt: new Date(firstResponseAt.getTime() + 600000) } });
    }
    if (safeResolvedAt) await db.ticketActivity.create({ data: { ticketId: t.id, actorId: assignee?.id, action: "status", fromValue: "IN_PROGRESS", toValue: "RESOLVED", createdAt: safeResolvedAt } });
    if (status === "CLOSED" && safeResolvedAt) await db.ticketActivity.create({ data: { ticketId: t.id, action: "status", fromValue: "RESOLVED", toValue: "CLOSED", createdAt: new Date(safeResolvedAt.getTime() + 43200_000) } });
    return t;
  };

  // ~60 días de historia
  for (let i = 0; i < 110; i++) {
    const daysAgo = Math.floor(Math.pow(rand(), 1.3) * 60);
    if (chance(0.62)) {
      const [title, description, c, impact, urgency] = pick(incidentTemplates);
      await makeTicket({ type: "INCIDENT", title, description, categoryId: c.id, teamId: c.teamId, impact, urgency, priority: priorityMatrix(impact, urgency), requesterId: pick(requesters).id, daysAgo });
    } else {
      const s = pick(services.filter((x) => x.id !== sNewUser.id));
      const req = pick(users);
      const formData: Record<string, string> = {};
      for (const f of s.formSchema as any[]) if (f.options) formData[f.key] = pick(f.options as string[]); else if (f.required) formData[f.key] = f.type === "date" ? new Date(now + 7 * 86400_000).toISOString().slice(0, 10) : "Martes y jueves";
      const approval = s.requiresApproval ? { approverId: req.managerId!, status: daysAgo < 2 && chance(0.6) ? "PENDING" as const : chance(0.08) ? "REJECTED" as const : "APPROVED" as const } : undefined;
      await makeTicket({ type: "REQUEST", title: s.name, description: s.description, categoryId: s.categoryId, teamId: s.ownerTeamId, impact: "LOW", urgency: "MEDIUM", priority: s.defaultPriority, requesterId: req.id, serviceItemId: s.id, formData, daysAgo, approval });
    }
  }

  // Casos guionados para la demo (visibles al iniciar sesión)
  await makeTicket({ type: "INCIDENT", title: "El sistema de bodega WMS está caído", description: "Nadie en bodega puede registrar despachos, el WMS no responde. Los camiones están esperando.", categoryId: cApps.id, teamId: tApps.id, impact: "HIGH", urgency: "HIGH", priority: "P1", requesterId: users[1]!.id, daysAgo: 0.05, forceStatus: "IN_PROGRESS" });
  await makeTicket({ type: "INCIDENT", title: "No puedo abrir Outlook, se queda cargando", description: "Desde esta mañana Outlook se queda en «Cargando perfil».", categoryId: cMail.id, teamId: tHelp.id, impact: "LOW", urgency: "MEDIUM", priority: "P4", requesterId: ana.id, daysAgo: 0.2, forceStatus: "IN_PROGRESS" });
  await makeTicket({ type: "INCIDENT", title: "La impresora de Finanzas no imprime", description: "La impresora HP del área de Finanzas muestra papel atascado.", categoryId: cPrint.id, teamId: tHelp.id, impact: "MEDIUM", urgency: "LOW", priority: "P4", requesterId: ana.id, daysAgo: 1.5, forceStatus: "RESOLVED" });
  await makeTicket({ type: "REQUEST", title: sAccess.name, description: "Necesito acceso a Power BI para los reportes de cierre.", categoryId: sAccess.categoryId, teamId: sAccess.ownerTeamId, impact: "LOW", urgency: "MEDIUM", priority: "P3", requesterId: ana.id, serviceItemId: sAccess.id, formData: { sistema: "Power BI", perfil: "Solo lectura", justificacion: "Revisar dashboards de cierre mensual." }, daysAgo: 0.1, approval: { approverId: approver.id, status: "PENDING" } });
  await makeTicket({ type: "REQUEST", title: sNewUser.name, description: "Ingreso de nueva analista contable.", categoryId: sNewUser.categoryId, teamId: sNewUser.ownerTeamId, impact: "LOW", urgency: "MEDIUM", priority: "P3", requesterId: approver.id, serviceItemId: sNewUser.id, formData: { nombre: "Daniela Ortiz", rut: encrypt("17.654.321-K"), cargo: "Analista contable", area: "Finanzas", ingreso: new Date(now + 5 * 86400_000).toISOString().slice(0, 10) }, daysAgo: 0.3, approval: { approverId: admin.id, status: "PENDING" } });
  await makeTicket({ type: "REQUEST", title: sNotebook.name, description: sNotebook.description, categoryId: sNotebook.categoryId, teamId: sNotebook.ownerTeamId, impact: "LOW", urgency: "MEDIUM", priority: "P3", requesterId: users[2]!.id, serviceItemId: sNotebook.id, formData: { modelo: "Liviano (viajes frecuentes)", motivo: "Equipo antiguo / lento" }, daysAgo: 0.4, approval: { approverId: approver.id, status: "PENDING" } });

  await db.organization.update({ where: { id: O }, data: { ticketSeq: number } });

  // Notificaciones iniciales
  const p1 = await db.ticket.findFirst({ where: { orgId: O, priority: "P1", status: "IN_PROGRESS" }, orderBy: { createdAt: "desc" } });
  await db.notification.createMany({
    data: [
      { orgId: O, userId: tomas!.id, kind: "danger", title: `Te asignaron un incidente crítico: INC-${p1?.number}`, body: "El sistema de bodega WMS está caído", link: `/tickets/${p1?.id}` },
      { orgId: O, userId: manager.id, kind: "danger", title: `Incidente crítico INC-${p1?.number}`, body: "El sistema de bodega WMS está caído", link: `/tickets/${p1?.id}` },
      { orgId: O, userId: approver.id, kind: "warning", title: "Tienes solicitudes por aprobar", body: "Ana Torres y Sofía Medina esperan tu aprobación.", link: "/approvals" },
      { orgId: O, userId: ana.id, kind: "success", title: "Tu problema con la impresora fue solucionado", body: "Confírmanos si quedó resuelto.", link: "/my-requests" },
    ],
  });

  // ============================================================ FASE 2: CMDB, problemas, cambios
  console.log("→ CMDB, problemas y cambios…");
  await db.serviceItem.update({ where: { id: sNotebook.id }, data: { secondApproverId: admin.id } }); // aprobación multinivel: jefatura → TI
  const ci = async (name: string, type: any, criticality: any, extra: Record<string, unknown> = {}) =>
    db.configItem.create({ data: { orgId: O, name, type, criticality, ...extra } });
  const vSap = await ci("SAP SE", "VENDOR", "HIGH", { contact: "Soporte SAP · 800-123-456 · contrato Enterprise", expiresAt: "2027-06-30" });
  const vMs = await ci("Microsoft", "VENDOR", "HIGH", { contact: "Soporte Microsoft 365 (portal de administración)", expiresAt: "2027-03-31" });
  const vEntel = await ci("Entel Empresas", "VENDOR", "HIGH", { contact: "Mesa NOC 24x7 · 600-360-0000 · SLA 4 h", expiresAt: "2026-12-31" });
  const vForti = await ci("Fortinet", "VENDOR", "MEDIUM", { contact: "Partner: SecureNet Chile", expiresAt: "2026-11-30" });
  const net = await ci("Enlace Internet Santiago", "NETWORK", "HIGH", { location: "Data center Santiago", description: "Fibra 500 Mbps principal" });
  const netAnt = await ci("Enlace Antofagasta", "NETWORK", "MEDIUM", { location: "Sucursal Antofagasta", description: "MPLS 100 Mbps" });
  const fw = await ci("FW-CORE-01", "NETWORK", "HIGH", { ipAddress: "10.0.0.1", version: "FortiOS 7.2.8", serial: "FG100F-0042", location: "Data center Santiago", ownerId: javiera!.id, teamId: tInfra.id });
  const sw2 = await ci("SW-PISO2", "NETWORK", "MEDIUM", { ipAddress: "10.0.2.2", location: "Piso 2 · Comercial", serial: "CSW-2290-118", ownerId: javiera!.id, teamId: tInfra.id });
  const srvSap = await ci("SRV-SAP-PRD-01", "SERVER", "HIGH", { ipAddress: "10.0.10.21", version: "SUSE 15 SP5", location: "Data center Santiago", ownerId: tomas!.id, teamId: tApps.id });
  const dbSap = await ci("DB-SAP-PRD", "DATABASE", "HIGH", { ipAddress: "10.0.10.22", version: "HANA 2.0 SPS07", ownerId: tomas!.id, teamId: tApps.id });
  const srvWms = await ci("SRV-WMS-01", "SERVER", "HIGH", { ipAddress: "10.0.10.31", version: "Windows Server 2022", location: "Data center Santiago", ownerId: javiera!.id, teamId: tInfra.id });
  const srvFile = await ci("SRV-FILE-01", "SERVER", "MEDIUM", { ipAddress: "10.0.10.40", version: "Windows Server 2019", ownerId: diego!.id, teamId: tInfra.id });
  const aSap = await ci("SAP S/4HANA", "APPLICATION", "HIGH", { version: "2023 FPS01", ownerId: tomas!.id, teamId: tApps.id });
  const aWms = await ci("WMS Bodega", "APPLICATION", "HIGH", { version: "8.4", ownerId: tomas!.id, teamId: tApps.id });
  const aSf = await ci("Salesforce Sales Cloud", "APPLICATION", "MEDIUM", { ownerId: tomas!.id, teamId: tApps.id });
  const aM365 = await ci("Microsoft 365", "APPLICATION", "HIGH", { description: "Correo, Teams, OneDrive y Office", ownerId: camila!.id, teamId: tHelp.id });
  const aVpn = await ci("FortiClient VPN", "APPLICATION", "MEDIUM", { version: "7.2", ownerId: javiera!.id, teamId: tInfra.id });
  await ci("Microsoft 365 E3", "LICENSE", "HIGH", { seats: 250, seatsUsed: 231, expiresAt: "2027-03-31", ownerId: admin.id });
  await ci("Adobe Acrobat Pro", "LICENSE", "LOW", { seats: 30, seatsUsed: 29, expiresAt: "2026-12-15", ownerId: camila!.id });
  await ci("AutoCAD LT", "LICENSE", "LOW", { seats: 5, seatsUsed: 5, expiresAt: "2026-11-20", ownerId: camila!.id });
  await ci("NB-0231 Dell Latitude 5440", "HARDWARE", "LOW", { serial: "DL5440-77812", location: "Piso 3 · Finanzas", description: "Asignado a Ana Torres", expiresAt: "2027-08-01" });
  const prn = await ci("HP LaserJet M507 · Finanzas", "HARDWARE", "LOW", { serial: "HPM507-1192", location: "Piso 3 · Finanzas", ipAddress: "10.0.3.50" });
  const svFac = await ci("Facturación y contabilidad", "SERVICE", "HIGH", { description: "Emisión de facturas, contabilidad y cierre mensual", ownerId: approver.id, teamId: tApps.id });
  const svDes = await ci("Despachos y bodega", "SERVICE", "HIGH", { description: "Recepción, picking y despacho de mercadería", ownerId: opsBoss.id, teamId: tApps.id });
  const svMail = await ci("Correo y colaboración", "SERVICE", "MEDIUM", { ownerId: camila!.id, teamId: tHelp.id });
  const svCrm = await ci("Ventas y CRM", "SERVICE", "MEDIUM", { teamId: tApps.id });
  const svVpn = await ci("Acceso remoto (VPN)", "SERVICE", "MEDIUM", { teamId: tInfra.id });
  const rel = (a: { id: string }, b: { id: string }, type = "DEPENDS_ON") => db.ciRelation.create({ data: { sourceId: a.id, targetId: b.id, type } });
  for (const [a, b, t] of [
    [aSap, srvSap, "RUNS_ON"], [aSap, dbSap, "USES"], [dbSap, srvSap, "RUNS_ON"], [aSap, vSap, "SUPPLIED_BY"],
    [aWms, srvWms, "RUNS_ON"], [aSf, net, "DEPENDS_ON"], [aM365, net, "DEPENDS_ON"], [aM365, vMs, "SUPPLIED_BY"],
    [aVpn, fw, "DEPENDS_ON"], [fw, net, "CONNECTS_TO"], [fw, vForti, "SUPPLIED_BY"], [net, vEntel, "SUPPLIED_BY"],
    [svFac, aSap, "DEPENDS_ON"], [svDes, aWms, "DEPENDS_ON"], [svDes, netAnt, "DEPENDS_ON"], [svMail, aM365, "DEPENDS_ON"],
    [svCrm, aSf, "DEPENDS_ON"], [svVpn, aVpn, "DEPENDS_ON"], [svCrm, sw2, "DEPENDS_ON"],
  ] as const) await rel(a, b, t);

  // Asociar incidentes existentes a su elemento afectado
  const ciRules: [RegExp, string][] = [[/WMS/i, aWms.id], [/Outlook|correo|Teams|Excel/i, aM365.id], [/VPN/i, aVpn.id], [/SAP|facturaci/i, aSap.id], [/Salesforce/i, aSf.id], [/segundo piso|Wi-Fi/i, sw2.id], [/Antofagasta/i, netAnt.id], [/impresora de Finanzas/i, prn.id]];
  const incs = await db.ticket.findMany({ where: { orgId: O, type: "INCIDENT" }, select: { id: true, title: true, createdAt: true, status: true } });
  for (const t of incs) { const r = ciRules.find(([re]) => re.test(t.title)); if (r) await db.ticket.update({ where: { id: t.id }, data: { configItemId: r[1] } }); }

  let prbSeq = 100;
  const wl = (entityType: string, entityId: string, actorId: string | null, action: string, note: string | null, createdAt: Date) => db.workLog.create({ data: { orgId: O, entityType, entityId, actorId, action, note, createdAt } });
  const mkProblem = async (d: { title: string; description: string; status: any; impact: Level; urgency: Level; categoryId: string; teamId: string; ownerId: string; rootCause?: string; workaround?: string; permanentFix?: string; daysAgo: number; match: RegExp; cis: string[]; tasks?: [string, string, boolean][] }) => {
    const createdAt = new Date(now - d.daysAgo * 86400_000);
    const p = await db.problem.create({ data: {
      orgId: O, number: ++prbSeq, title: d.title, description: d.description, status: d.status, impact: d.impact, urgency: d.urgency, priority: priorityMatrix(d.impact, d.urgency),
      categoryId: d.categoryId, teamId: d.teamId, ownerId: d.ownerId, createdById: manager.id, rcaMethod: d.rootCause ? "five_whys" : null, rootCause: d.rootCause, workaround: d.workaround, permanentFix: d.permanentFix,
      knownErrorAt: ["KNOWN_ERROR", "RESOLVED"].includes(d.status) && d.workaround ? new Date(createdAt.getTime() + 2 * 86400_000) : null,
      resolvedAt: d.status === "RESOLVED" ? new Date(createdAt.getTime() + 5 * 86400_000) : null, createdAt, configItems: { connect: d.cis.map((id) => ({ id })) },
    } });
    const linked = incs.filter((t) => d.match.test(t.title)).map((t) => t.id);
    await db.ticket.updateMany({ where: { id: { in: linked } }, data: { problemId: p.id } });
    await wl("problem", p.id, manager.id, "created", `Con ${linked.length} incidente(s) vinculados`, createdAt);
    if (d.rootCause) await wl("problem", p.id, d.ownerId, "field:rootCause", null, new Date(createdAt.getTime() + 86400_000));
    if (d.status !== "NEW") await wl("problem", p.id, d.ownerId, `status:${d.status}`, null, new Date(createdAt.getTime() + 2 * 86400_000));
    for (const [title, owner, done] of d.tasks ?? []) await db.problemTask.create({ data: { problemId: p.id, title, ownerId: owner, dueDate: new Date(now + (done ? -3 : 7) * 86400_000).toISOString().slice(0, 10), doneAt: done ? new Date(now - 2 * 86400_000) : null } });
    return p;
  };
  await mkProblem({ title: "Outlook se cuelga al abrir perfiles de correo grandes", description: "Varios usuarios reportan que Outlook queda en «Cargando perfil». Todos tienen buzones sobre 45 GB.", status: "KNOWN_ERROR", impact: "MEDIUM", urgency: "MEDIUM", categoryId: cMail.id, teamId: tHelp.id, ownerId: camila!.id, daysAgo: 18, match: /Outlook/i, cis: [aM365.id],
    rootCause: "1) Outlook se cuelga al iniciar → 2) el archivo OST supera 50 GB → 3) el modo caché descarga todo el buzón → 4) no existe política de archivado → 5) los buzones crecen sin límite desde la migración de 2023.",
    workaround: "1. Cierra Outlook.\n2. Abre Panel de control > Correo > Cuentas de correo > Cambiar.\n3. Reduce «Correo sin conexión» a 6 meses.\n4. Vuelve a abrir Outlook y espera la sincronización.",
    tasks: [["Definir política de archivado de 2 años", camila!.id, true], ["Aplicar archivado en línea a buzones > 40 GB", diego!.id, false], ["Comunicar la política a todas las áreas", manager.id, false]] });
  await mkProblem({ title: "Lentitud recurrente de internet en el piso 2", description: "El equipo comercial reporta lentitud entre 10:00 y 12:00 casi a diario.", status: "INVESTIGATING", impact: "MEDIUM", urgency: "MEDIUM", categoryId: cNet.id, teamId: tInfra.id, ownerId: javiera!.id, daysAgo: 9, match: /segundo piso|Salesforce muy lento/i, cis: [sw2.id],
    tasks: [["Monitorear uso de ancho de banda del switch por 1 semana", javiera!.id, false]] });
  const prbWms = await mkProblem({ title: "Caídas del WMS por agotamiento de conexiones a la base de datos", description: "El WMS deja de responder en horas peak de despacho.", status: "RESOLVED", impact: "HIGH", urgency: "HIGH", categoryId: cApps.id, teamId: tApps.id, ownerId: tomas!.id, daysAgo: 40, match: /WMS/i, cis: [aWms.id, srvWms.id],
    rootCause: "El pool de conexiones del WMS estaba limitado a 50; en peak se superan 80 sesiones simultáneas y las nuevas quedan en espera indefinida.",
    workaround: "Reiniciar el servicio «WMS App Pool» en SRV-WMS-01 (libera conexiones colgadas).",
    permanentFix: "Se aumentó el pool a 200 conexiones y se configuró timeout de 30 s (CHG-101).", tasks: [["Ajustar pool de conexiones", tomas!.id, true], ["Agregar alerta de conexiones > 150", javiera!.id, true]] });
  await mkProblem({ title: "El escáner del primer piso no envía documentos al correo", description: "Falla intermitente del envío SMTP desde el escáner.", status: "NEW", impact: "LOW", urgency: "LOW", categoryId: cPrint.id, teamId: tHelp.id, ownerId: diego!.id, daysAgo: 3, match: /Escáner/i, cis: [] });
  await db.organization.update({ where: { id: O }, data: { problemSeq: prbSeq } });

  let chgSeq = 100;
  const at = (days: number, hour: number) => { const d = new Date(now + days * 86400_000); d.setUTCHours(hour + 3, 0, 0, 0); return d; }; // hora local Chile (UTC-3)
  const mkChange = async (d: { title: string; description: string; type: any; status: any; risk: Level; impact: Level; riskScore: number; start: Date; end: Date; cis: string[]; ownerId: string; teamId: string; outcome?: any; review?: string; problemId?: string; approvals?: [string, number, any][]; riskAnswers?: Record<string, boolean> }) => {
    const createdAt = new Date(Math.min(d.start.getTime() - 5 * 86400_000, now - 86400_000));
    const c = await db.change.create({ data: {
      orgId: O, number: ++chgSeq, title: d.title, description: d.description, type: d.type, status: d.status, risk: d.risk, impact: d.impact, riskScore: d.riskScore, riskAnswers: d.riskAnswers ?? {},
      reason: "Mantener la continuidad operacional y la seguridad de la plataforma.",
      implementationPlan: "1. Respaldo completo y snapshot.\n2. Aviso a usuarios clave 24 h antes.\n3. Aplicar el cambio según procedimiento del proveedor.\n4. Pruebas de humo con usuarios clave.",
      rollbackPlan: "Restaurar el snapshot previo (tiempo estimado 30 min) y validar servicios.", testPlan: "Verificar acceso, transacciones de prueba y monitoreo por 2 h.",
      plannedStart: d.start, plannedEnd: d.end, actualStart: d.outcome ? d.start : null, actualEnd: d.outcome ? d.end : null, outcome: d.outcome, reviewNotes: d.review,
      requesterId: d.ownerId, ownerId: d.ownerId, teamId: d.teamId, problemId: d.problemId, createdAt, configItems: { connect: d.cis.map((id) => ({ id })) },
    } });
    for (const [approverId, level, status] of d.approvals ?? []) await db.changeApproval.create({ data: { changeId: c.id, approverId, level, status, decidedAt: status === "PENDING" ? null : new Date(createdAt.getTime() + 86400_000), createdAt } });
    await wl("change", c.id, d.ownerId, "created", null, createdAt);
    if (d.status !== "DRAFT") await wl("change", c.id, d.ownerId, `status:${d.type === "STANDARD" ? "SCHEDULED" : "PENDING_APPROVAL"}`, d.type === "STANDARD" ? "Cambio estándar preaprobado" : "Enviado al CAB", new Date(createdAt.getTime() + 3600_000));
    if (d.outcome) await wl("change", c.id, d.ownerId, "status:REVIEW", d.outcome === "SUCCESSFUL" ? "Exitoso" : "Revertido — la migración superó la ventana; se ejecutó el plan de reversa.", d.end);
    if (d.review) await wl("change", c.id, manager.id, "status:CLOSED", d.review, new Date(d.end.getTime() + 86400_000));
    return c;
  };
  const okApproval: [string, number, any][] = [[manager.id, 1, "APPROVED"]];
  await mkChange({ title: "Aumentar el pool de conexiones del WMS", description: "Ajuste de configuración del pool de conexiones de 50 a 200 y timeout de 30 s.", type: "NORMAL", status: "CLOSED", risk: "MEDIUM", impact: "HIGH", riskScore: 5, start: at(-33, 22), end: at(-33, 23), cis: [aWms.id, srvWms.id], ownerId: tomas!.id, teamId: tApps.id, outcome: "SUCCESSFUL", review: "Sin caídas del WMS en 30 días. Problema PRB-103 resuelto.", problemId: prbWms.id, approvals: okApproval });
  await mkChange({ title: "Migración de buzones al nuevo plan de archivado", description: "Mover buzones > 40 GB a archivado en línea.", type: "NORMAL", status: "CLOSED", risk: "MEDIUM", impact: "MEDIUM", riskScore: 5, start: at(-20, 20), end: at(-20, 23), cis: [aM365.id], ownerId: diego!.id, teamId: tHelp.id, outcome: "ROLLED_BACK", review: "Se reprogramará por lotes de 20 buzones. Lección: estimar tiempos con una prueba piloto.", approvals: okApproval });
  await mkChange({ title: "Instalar switch adicional en bodega", description: "Nuevo switch de acceso para lectores de código de barras.", type: "STANDARD", status: "CLOSED", risk: "LOW", impact: "LOW", riskScore: 1, start: at(-25, 19), end: at(-25, 20), cis: [netAnt.id], ownerId: javiera!.id, teamId: tInfra.id, outcome: "SUCCESSFUL", review: "Lectores operativos." });
  await mkChange({ title: "Reinicio de emergencia del servidor WMS", description: "Reinicio controlado para restaurar el servicio de despachos (incidente P1).", type: "EMERGENCY", status: "REVIEW", risk: "HIGH", impact: "HIGH", riskScore: 9, start: new Date(now - 2 * 3600_000), end: new Date(now - 1.5 * 3600_000), cis: [srvWms.id], ownerId: javiera!.id, teamId: tInfra.id, outcome: "SUCCESSFUL", approvals: [[manager.id, 1, "APPROVED"]] });
  await mkChange({ title: "Parches de seguridad mensuales de Windows Server", description: "Actualizaciones acumulativas de noviembre en servidores Windows.", type: "STANDARD", status: "SCHEDULED", risk: "LOW", impact: "MEDIUM", riskScore: 2, start: at(2, 22), end: at(3, 2), cis: [srvFile.id, srvWms.id], ownerId: diego!.id, teamId: tInfra.id });
  await mkChange({ title: "Actualizar firmware del firewall FW-CORE-01", description: "Actualización a FortiOS 7.4.4 por vulnerabilidad crítica publicada por el fabricante.", type: "NORMAL", status: "PENDING_APPROVAL", risk: "HIGH", impact: "MEDIUM", riskScore: 9, start: at(5, 23), end: at(6, 1), cis: [fw.id], ownerId: javiera!.id, teamId: tInfra.id, riskAnswers: { production: true, downtime: true, untested: true }, approvals: [[manager.id, 1, "PENDING"]] });
  await mkChange({ title: "Migrar enlace de Internet a fibra de 1 Gbps", description: "Cambio de última milla con Entel. Requiere corte de 30 min.", type: "NORMAL", status: "SCHEDULED", risk: "MEDIUM", impact: "MEDIUM", riskScore: 5, start: at(5, 22), end: at(6, 0), cis: [net.id, fw.id], ownerId: javiera!.id, teamId: tInfra.id, approvals: okApproval });
  await mkChange({ title: "Actualizar SAP S/4HANA a FPS02", description: "Actualización de feature pack con nuevas validaciones tributarias.", type: "NORMAL", status: "DRAFT", risk: "HIGH", impact: "HIGH", riskScore: 10, start: at(24, 20), end: at(25, 6), cis: [aSap.id, dbSap.id], ownerId: tomas!.id, teamId: tApps.id, riskAnswers: { production: true, downtime: true, noRollback: true } });
  await db.organization.update({ where: { id: O }, data: { changeSeq: chgSeq } });

  // Automatizaciones de ejemplo (Fase 3)
  await db.automationRule.createMany({ data: [
    { orgId: O, name: "Avisar a gestores ante incidentes críticos", trigger: "ticket.created", position: 0, conditions: [{ field: "priority", op: "eq", value: "P1" }], actions: [{ type: "notify_managers" }] },
    { orgId: O, name: "Derivar problemas de VPN a Infraestructura", trigger: "ticket.created", position: 1, conditions: [{ field: "type", op: "eq", value: "INCIDENT" }, { field: "text", op: "contains", value: "vpn" }], actions: [{ type: "assign_team", value: tInfra.id }] },
    { orgId: O, name: "Escalar P2 con SLA vencido", trigger: "sla.breached", position: 2, conditions: [{ field: "priority", op: "eq", value: "P2" }], actions: [{ type: "escalate" }, { type: "add_note", value: "Escalado automáticamente: SLA de resolución vencido." }] },
  ] });

  // ------------------------------------------------------------ Segunda organización (demuestra aislamiento multi-tenant)
  const org2 = await db.organization.create({ data: { name: "Globex Retail", slug: "globex", plan: "starter" } });
  const g = await db.user.create({ data: { orgId: org2.id, email: "admin@globex.demo", name: "Hernán Ibáñez", role: "ORG_ADMIN", passwordHash: hash } });
  const gUser = await db.user.create({ data: { orgId: org2.id, email: "maria@globex.demo", name: "María López", role: "END_USER", passwordHash: hash } });
  const gTeam = await db.team.create({ data: { orgId: org2.id, name: "Soporte TI", members: { create: [{ userId: g.id, isLead: true }] } } });
  await db.category.create({ data: { orgId: org2.id, name: "General", keywords: ["error"], teamId: gTeam.id } });
  for (const p of ["P1", "P2", "P3", "P4"] as const) await db.slaPolicy.create({ data: { orgId: org2.id, priority: p, name: p, responseMinutes: 60, resolutionMinutes: 480 } });
  await db.ticket.create({ data: { orgId: org2.id, number: 1, type: "INCIDENT", title: "Caja registradora tienda 12 no imprime boletas", description: "Confidencial de Globex", requesterId: gUser.id, teamId: gTeam.id, priority: "P2", impact: "MEDIUM", urgency: "HIGH" } });
  await db.organization.update({ where: { id: org2.id }, data: { ticketSeq: 1 } });

  const count = await db.ticket.count({ where: { orgId: O } });
  console.log(`✔ Listo: ${count} tickets en «${org.name}», ${services.length} servicios, 10 artículos, ${await db.configItem.count({ where: { orgId: O } })} elementos CMDB, ${prbSeq - 100} problemas, ${chgSeq - 100} cambios.`);
  console.log(`  Contraseña de todos los usuarios demo: ${PASSWORD}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
