# Notas de versión para Fer

Práctica vigente desde la issue #245 (2026-11-08). Cada liberación a
producción lleva, además del `src/releases/releases.json` compacto (el pie de
la app), un **mensaje listo para copiar y enviarle a Fer**. El estilo de
referencia es el mensaje que el PO le mandó con la 1.9.0: lo que le sirve es
saber qué cambia en SU trabajo, no qué hicimos por dentro.

## Plantilla — 4 bloques fijos

```
Versión <número> — <título corto y humano>

Lo más importante:
• <el cambio que más le importa a su día> — <por qué, en una frase>.

Lo que se corrigió:
• <dolores que ELLA vivió, contados como ella los cuenta>.

Lo nuevo que puedes hacer:
• <acciones nuevas, con la ruta: "en Pedidos → …">. (Si no hay nada visible:
  dilo sin rodeos: "esta versión es de mantenimiento; no hay botones nuevos").

Qué te pedimos probar:
• <1 a 3 recorridos concretos, con resultado esperado>.
```

## Reglas de redacción

- Háblale de tú, frases cortas, una idea por línea.
- Vocabulario de operadora: pedidos, cobros, clientas, compras, catálogo,
  tienda. Cero jerga: nada de reglas, SDK, PR, issue, commit, base de datos.
- Si el cambio es invisible para ella (seguridad, dependencias, pruebas),
  dilo honesto en una línea — no le inventes beneficios.
- Nada de números de issue ni nombres de pantalla internos; si sirve, nombra
  la pestaña tal como la ve ("Pedidos", "Compras").
- Máximo ~10 líneas: es un mensaje de WhatsApp, no un informe.
- El pie de la app (`releases.json`) sigue compacto y funcional; este
  mensaje es el que se le envía a ella y queda como comentario del PR de
  release (evidencia de la práctica).

## Ejemplo — forma de referencia (borrador para 1.9.1)

El mensaje real de cada release se **regenera desde el diff liberado** (nunca
se copia este ejemplo tal cual: podría prometer algo que no viajó).

> Versión 1.9.1 — Más privacidad entre tiendas
>
> Lo más importante: nadie fuera de tu tienda puede ver los correos de tu
> equipo ni de tus clientas. Lo tuyo sigue siendo tuyo.
>
> Lo que se corrigió: las invitaciones quedan "pendientes" hasta que la
> persona entra con ese correo, tenga o no cuenta.
>
> Lo nuevo: esta versión es de cuidado por dentro; no hay botones nuevos.
>
> Qué te pedimos probar: invita a alguien desde "Administrar tienda" y
> confirma que aparezca "pendiente" y que al entrar vea tu tienda.

Las notas ya publicadas de versiones anteriores NO se reescriben: viven en el
bundle liberado. La plantilla rige desde la primera liberación posterior a
este documento.
