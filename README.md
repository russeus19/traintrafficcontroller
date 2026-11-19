# Train Traffic Controller

Simulador de circulación ferroviaria: eres factor de circulación en la estación de Santa Olalla de Bureba (Burgos – Miranda de Ebro), a finales de los noventa.

Proyecto de uso privado.

## Cómo funciona

Web estática, sin compilación: `index.html` carga three.js (r149) desde cdnjs y después, en este orden, `material.js`, `gente3d.js`, `niveles/santa-olalla.js` y `motor.js`.

Para probarlo en local hace falta un servidor (no basta con abrir el archivo):

```
python -m http.server 8000
```

y abrir http://localhost:8000

Las partidas se guardan en el navegador (localStorage).

## Créditos

- Modelo base de las personas: alicewithalex, licencia CC BY 4.0.
