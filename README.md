# Telcel Store — Chips y eSIM Online

Tienda online completa para vender **chips Telcel** y **eSIM Telcel**, con:

- Catálogo de productos (chips físicos y eSIM)
- Carrito de compras
- Checkout integrado con **Clip** (pasarela de pagos México)
- Panel de administración (órdenes, productos, estadísticas)
- Listo para desplegar en **Railway**

## Requisitos

- Node.js 18+
- Cuenta de [Clip](https://clip.mx) (para pagos reales)
- Cuenta de [Railway](https://railway.app) (opcional)

## Inicio rápido (local)

```bash
cd telcel-store
cp .env.example .env
# Edita .env con tus claves Clip (o déjalas vacías para modo demo)
npm install
npm start
```

Abre:

- **Tienda:** http://localhost:3000  
- **Admin:** http://localhost:3000/admin  
  - Email: `admin@telcel.store`  
  - Password: `Admin123!` (cámbiala en producción)

La base de datos (archivo JSON) se crea automáticamente en `./data/store.json` al primer arranque.

### Modo demo sin Clip

Si no configuras `CLIP_API_KEY` y `CLIP_API_SECRET`, el checkout marca las órdenes como **pagadas en modo demo**. Ideal para probar el flujo completo.

## Configurar Clip

1. Entra a [dashboard.clip.mx](https://dashboard.clip.mx)
2. **Panel de desarrolladores → Credenciales**
3. Crea una credencial para **Tienda online** e indica el dominio de tu app
4. Copia **API Key** y **Clave secreta**
5. En `.env`:

```env
CLIP_API_KEY=tu_api_key
CLIP_API_SECRET=tu_api_secret
CLIP_SANDBOX=true          # false en producción
BASE_URL=https://tu-dominio.com
SESSION_SECRET=un_secreto_largo_y_aleatorio
```

El backend crea un **link de pago** con la API de Checkout de Clip (`POST https://api.payclip.com/v2/checkout`) y redirige al cliente. Clip notifica vía webhook a `/api/webhooks/clip`.

Docs: https://developer.clip.mx/

## Desplegar en Railway

### 1. Sube el proyecto a GitHub

### 2. Railway → New Project → Deploy from GitHub

### 3. Variables de entorno

| Variable | Valor |
|----------|--------|
| `CLIP_API_KEY` | Tu API Key de Clip |
| `CLIP_API_SECRET` | Tu Secret de Clip |
| `CLIP_SANDBOX` | `false` (producción) |
| `BASE_URL` | `https://tu-proyecto.up.railway.app` |
| `SESSION_SECRET` | String largo y aleatorio |
| `ADMIN_EMAIL` | Tu correo admin |
| `ADMIN_PASSWORD` | Contraseña fuerte |
| `DB_PATH` | `/data/store.json` |

### 4. Volume (importante)

Agrega un **Volume** montado en `/data` para que los datos (productos, órdenes) no se pierdan al reiniciar.

### 5. Deploy

Railway detecta Node y ejecuta `npm start`. Health check en `/health`.

## Estructura

```
telcel-store/
├── server.js
├── package.json
├── .env.example
├── railway.toml
├── db/store.js          # Base de datos JSON
├── routes/api.js        # API + webhook Clip
├── services/clip.js     # Integración Clip Checkout
├── middleware/auth.js
└── public/              # Frontend (tienda + admin)
```

## Flujo de pago

1. Cliente agrega productos al carrito
2. Completa datos (nombre, email, teléfono, dirección)
3. Backend crea orden y llama a Clip → recibe `payment_request_url`
4. Cliente es redirigido a Clip para pagar
5. Clip redirige a `/pago/exito` o `/pago/error`
6. Webhook actualiza el estado de la orden y descuenta stock


## Webhooks de Clip

Al crear un link de pago se envía automáticamente:

```json
"webhook_url": "https://tu-dominio.com/api/webhooks/clip"
```

### Flujo

1. Clip envía un POST a `/api/webhooks/clip` con:
   ```json
   { "id": "<payment_request_id>", "origin": "checkout-api", "event_type": "INSERT|UPDATE" }
   ```
2. El servidor responde **200** de inmediato.
3. Consulta `GET /v2/checkout/{id}` en la API de Clip para obtener el estado real.
4. Actualiza la orden local:
   - `CHECKOUT_COMPLETED` → `paid` + descuenta stock (idempotente)
   - `CHECKOUT_CANCELLED` / `CHECKOUT_EXPIRED` → `failed`
5. Guarda un log del evento (visible en Admin → Webhooks Clip).

### Fallback en página de éxito

Cuando el cliente vuelve a `/pago/exito?order=...`, la página llama a:

```
POST /api/orders/:orderNumber/sync
```

para sincronizar por si el webhook aún no llegó (red lenta, Railway frío, etc.). Reintenta varias veces si sigue en `pending`.

### Requisitos

- `BASE_URL` debe ser la URL **pública HTTPS** de tu app (Railway o dominio).
- En las credenciales de Clip (Tienda online) registra el mismo dominio.
- El endpoint siempre responde 200 para evitar reintentos agresivos de Clip ante errores internos.

## Seguridad

- Cambia `SESSION_SECRET` y la contraseña del admin
- Nunca expongas `CLIP_API_SECRET` en el frontend
- Configura el dominio real en las credenciales de Clip

## Licencia

MIT
