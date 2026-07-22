# DatosDeFutbol.com — Instrucciones de puesta en marcha

Esta web no necesita programación para funcionar ni para mantenerse. Sigue estos
pasos en orden, una sola vez, y luego los resultados/clasificación se actualizarán
solos cada día.

## Paso 1 — Crear cuenta de GitHub (gratis)
1. Ve a [github.com](https://github.com) y crea una cuenta si no tienes.

## Paso 2 — Crear el repositorio y subir estos archivos
1. En GitHub, pulsa **"New repository"**.
2. Nómbralo `datosdefutbol` (o el nombre que prefieras). Déjalo **público**.
3. No marques ninguna casilla de "añadir README" (ya tenemos uno).
4. Crea el repositorio.
5. Dentro del repositorio vacío, pulsa **"uploading an existing file"**.
6. Arrastra **todos los archivos y carpetas** de esta carpeta que te he entregado
   (incluye la carpeta `.github`, aunque a veces no se ve por empezar con un punto —
   asegúrate de que se sube).
7. Pulsa **"Commit changes"**.

## Paso 3 — Conseguir tu clave gratuita de datos de fútbol
1. Ve a [football-data.org/client/register](https://www.football-data.org/client/register)
   y regístrate (plan gratuito).
2. Te dan una clave (API key), una cadena de letras y números. Cópiala.

## Paso 4 — Guardar la clave en GitHub (de forma segura, sin que se vea públicamente)
1. En tu repositorio, ve a **Settings → Secrets and variables → Actions**.
2. Pulsa **"New repository secret"**.
3. Nombre: `FOOTBALL_API_KEY`
4. Valor: pega la clave que copiaste en el Paso 3.
5. Guarda.

## Paso 5 — Activar el robot que actualiza los datos
1. Ve a la pestaña **"Actions"** de tu repositorio.
2. Si te pide activar Actions, acéptalo.
3. Verás el flujo **"Actualizar datos de fútbol"**. Puedes pulsar **"Run workflow"**
   para probarlo manualmente ahora mismo, sin esperar a la ejecución automática de
   las 07:00 UTC.
4. Si todo va bien, verás que se actualizan los archivos dentro de la carpeta `data/`.

## Paso 6 — Activar GitHub Pages (para que la web sea visible en internet)
1. Ve a **Settings → Pages**.
2. En "Source", elige la rama `main` y la carpeta `/ (root)`.
3. Guarda. En unos minutos tu web estará visible en una dirección tipo
   `tu-usuario.github.io/datosdefutbol`.

## Paso 7 — Conectar tu dominio datosdefutbol.com
1. En **Settings → Pages**, en el campo "Custom domain", escribe `datosdefutbol.com`
   y guarda (esto ya coincide con el archivo `CNAME` que viene incluido).
2. Ve al panel de tu proveedor de dominio (donde lo compraste) y añade estos
   registros DNS:
   - Cuatro registros tipo **A** apuntando a:
     `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - Un registro **CNAME** para `www` apuntando a `tu-usuario.github.io`
3. Los cambios de DNS pueden tardar hasta 24h en aplicarse (normalmente mucho menos).
4. Vuelve a Settings → Pages y activa **"Enforce HTTPS"** cuando esté disponible.

---

## Cómo publicar un artículo nuevo (sin tocar código)

1. Dentro de la carpeta `articulos/`, duplica el archivo `ejemplo-articulo.html`
   (en GitHub: ábrelo, pulsa el lápiz de editar, selecciona todo, copia; luego crea
   un archivo nuevo, ej. `madrid-betis-jornada24.html`, y pega el contenido).
2. Edita solo las partes marcadas con comentarios `<!-- CAMBIA ... -->`: título,
   descripción, categoría, fecha y los párrafos del artículo.
3. Guarda (commit).
4. Abre `articulos.html` e `index.html`, copia el bloque `<a class="article">...</a>`
   de ejemplo, pégalo justo encima o debajo, y cambia el `href` al nombre de tu
   nuevo archivo, más el texto del recuadro, título y resumen.
5. Guarda (commit). Listo, ya está publicado.

## Cómo poner los anuncios de Google AdSense

1. Regístrate en [google.com/adsense](https://www.google.com/adsense).
2. Cuando te aprueben, Google te da un código `<script>` para pegar en el `<head>`
   de todas las páginas, y un código por cada anuncio.
3. Sustituye cada `<div class="ad-slot">...</div>` por el código de anuncio que
   te dé AdSense para ese hueco.

## Cambiar de liga

Si en el futuro quieres cambiar de LaLiga a otra liga (Premier League, Serie A...),
solo tienes que abrir `scripts/update_data.py` y cambiar la línea:
```
COMPETITION = "PD"
```
por el código de la competición que quieras (`PL` = Premier League, `SA` = Serie A,
`BL1` = Bundesliga, `FL1` = Ligue 1). La lista completa está en la documentación de
football-data.org.
