# Backend de facturación para POS independiente

Copia del backend de `C:\facturacion\facturacion\apps\backend` preparada para correr en la nube
(Render) y atender a las terminales POS sin una PC servidor. La base de datos sigue siendo la de
Aiven; este servicio es el único que tiene sus credenciales.

```
Terminal POS  --https-->  este backend (Render)  --SSL-->  MySQL en Aiven
```

## Diferencias con el backend original

- `tsconfig.json` propio (no depende del monorepo) y compila solo `src/`.
- Incluye las carpetas `migrations/` y `migrations-mssql/` para que el control de versión de la
  base funcione igual que en el sistema principal.
- `render.yaml` con la configuración del servicio.

El código de `src/` es el mismo. Si el sistema principal agrega migraciones, copia también las
nuevas aquí y vuelve a desplegar: si la base tiene migraciones que este programa no conoce, el
backend bloquea las operaciones (aviso de "programa desactualizado").

## Correr en local

```bash
npm install
npm run build
npm start
```

Configuración: copia `.env.example` como `.env`, o usa variables de entorno.

## Desplegar en Render

1. Sube esta carpeta a un repositorio de GitHub (privado).
2. En Render: **New > Blueprint**, elige el repositorio. Render lee `render.yaml`.
3. Completa los valores que pide: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
   (los de Aiven; usa un usuario propio para el sistema, no `avnadmin`).
4. En el servicio: **Environment > Secret Files**, agrega `ca.pem` con el certificado CA de Aiven.
5. Si Aiven tiene restringidas las IP permitidas, agrega las IP de salida del servicio
   (Render las muestra en **Connect > Outbound**).
6. Al terminar, prueba `https://<servicio>.onrender.com/api/health`: debe responder
   `"ok": true, "database": true`.

Esa dirección `https://...onrender.com` es la que se escribe en la terminal POS al instalarla.

El plan **starter** (de pago) queda siempre encendido. El plan gratuito se duerme tras unos
minutos sin uso y la primera venta tardaría cerca de un minuto.
