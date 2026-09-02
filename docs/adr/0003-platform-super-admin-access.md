# ADR 0003 — Acceso global operativo de `super_admin`

- **Estado:** Aceptado
- **Fecha:** 2026-09-01
- **Decisor:** Álvaro González (Product Owner)
- **Reemplaza parcialmente:** G-P02 de la Espec 1 de seguridad

## Contexto

Store OS necesita que la persona administradora de la plataforma pueda corregir
configuración y operar tiendas aunque no sea miembro de ellas. En particular,
el `super_admin` debe poder configurar el WhatsApp de Olivia y atender fallas
de catálogo sin pedir una membresía temporal a la dueña.

La documentación de seguridad anterior describía al `super_admin` como un rol
limitado al plano de control. Esa restricción ya no coincide con la decisión de
producto ni con el flujo administrativo usado por Store OS.

## Decisión

`super_admin` es una cuenta privilegiada de plataforma con acceso global de
lectura y escritura a los datos operativos actuales de cualquier tienda:

- tienda y configuración, incluido WhatsApp y contenido público;
- productos, categorías, proveedores, compras, inventario, costos, clientes y
  pedidos;
- fotografías y otros archivos operativos de Storage;
- proyecciones públicas y metadatos de membresía necesarios para administrar.

Los miembros ordinarios siguen restringidos a las tiendas de `memberUids` y la
relación `ownerUid` conserva los controles propios de la dueña. Las reglas de
Firebase son la frontera autoritativa; el filtrado de la UI no es una medida de
seguridad.

`adminStores` permanece como fuente canónica para membresía y propiedad. Su
allow-list no se amplía con datos de negocio. El superadmin lee el documento
completo de `stores` porque necesita operar la configuración y el contenido,
pero eso no cambia las allow-lists de `publicStores`, `publicCatalogs` ni
`publicProducts`.

La cuenta `admin@store.os` verificada es la identidad de plataforma permitida
para conservar o recuperar el rol `super_admin`. No se agrega un panel nuevo en
esta decisión: el acceso se ejerce mediante el selector de tiendas y las
pantallas administrativas existentes.

## Consecuencias y límites

- El superadmin puede ver PII operativa de las tiendas; es un acceso privilegiado
  deliberado y debe mantenerse limitado a las cuentas de plataforma autorizadas.
- G-P01 sigue garantizando que un miembro no cruce tiendas. G-P02 ya no significa
  “superadmin sin datos”; significa que el acceso global es explícito y probado.
- Los ambientes `store-os-dev` y `store-os-f7cf8` siguen aislados; no se copian
  datos entre ellos.
- Una colección operativa nueva debe declarar expresamente si pertenece a este
  acceso global. Esta ADR no autoriza automáticamente futuras colecciones de
  privacidad o cumplimiento.

## Evidencia obligatoria

Las pruebas de reglas deben cubrir superadmin no miembro leyendo y modificando
datos de otra tienda, y miembro de una tienda intentando cruzar a otra. Las
pruebas de proyección deben demostrar que el acceso administrativo no vuelve
públicos campos privados.
