# Barrera explícita para liberar a producción

## Problema

Hoy, cada cambio de código que llega a `main` ejecuta un despliegue de Vercel
contra producción y publica reglas en los dos proyectos Firebase. Además, el
workflow selecciona credenciales de producción para algunas pruebas de `main`.
Un merge no equivale a aprobación para liberar.

## Comportamiento acordado

- Pull requests y pruebas de `main` usan siempre las credenciales Preview de
  `store-os-dev`; las pruebas Firebase conectan sus servicios a emuladores
  locales usando el ID `store-os-dev`.
- Un push a `main` publica reglas de Firestore y Storage únicamente en
  `store-os-dev`, comprueba paridad y despliega la aplicación a Vercel Preview.
- Producción solo se libera con una ejecución manual del workflow `CI`, sobre
  `main`, con `release_production=true`. La ejecución repite validaciones con
  credenciales dev y después publica reglas y aplicación desde el mismo commit
  de `main`.
- Si `release_production` queda en `false`, ninguna tarea puede publicar reglas
  ni aplicación en producción.
- El prerender que lee el catálogo de producción solo se ejecuta durante esa
  liberación explícita. Preview no recibe credenciales de servicio de producción
  ni intenta leer datos productivos.

## Límites

No publicar datos de prueba, no copiar seeds y no ejecutar liberaciones durante
la validación del PR. El workflow no añade servicios ni consumo adicional de
Firestore en las operaciones de la aplicación.

## Validación

Revisar las condiciones de eventos, ramas, entrada manual y entornos del
workflow; ejecutar CI en el PR. En un merge de prueba, confirmar que el destino
es dev/Preview y que Producción queda omitida. No despachar una liberación real
como parte de la prueba.
