# GymHour Template - Deploy por cliente

Este repositorio contiene dos proyectos separados:

- `api-gymhour`: API en Node.js, Express, TypeScript y Prisma.
- `front-gymhour`: frontend en React.

Para crear un deploy para un cliente nuevo se reutiliza el mismo codigo base. La configuracion que cambia por cliente esta concentrada en:

- API: variables `FRONTEND_URL` y `DATABASE_URL`.
- Frontend: archivo `front-gymhour/src/setup.js`.

## 1. Preparar el cliente

Antes de hacer el deploy, definir:

- Nombre del cliente o gimnasio.
- URL final del frontend.
- URL final de la API.
- Base de datos del cliente.
- Datos visuales y comerciales del frontend: logos, colores, datos de pago y WhatsApp.

Cada cliente debe tener su propia base de datos. No reutilizar la `DATABASE_URL` de otro cliente.

## 2. Deploy de la API

La API esta en:

```bash
api-gymhour
```

### Variables por cliente

En el panel del proveedor de deploy, configurar estas variables:

```env
FRONTEND_URL=https://frontend-del-cliente.com
DATABASE_URL=mysql://usuario:password@host:puerto/database
```

`FRONTEND_URL` debe apuntar al dominio publico del frontend del cliente. Se usa para links enviados por email, por ejemplo recuperacion de password.

`DATABASE_URL` debe apuntar a la base de datos MySQL del cliente. Prisma toma esta variable desde `api-gymhour/prisma/schema.prisma`.

### Otras variables necesarias

Segun las funcionalidades activas, la API tambien puede requerir variables compartidas o especificas del entorno:

```env
JWT_SECRET=valor-seguro
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=usuario@example.com
SMTP_PASS=password
SMTP_FROM=usuario@example.com
CLOUDINARY_NAME=cloud-name
CLOUDINARY_API_KEY=api-key
CLOUDINARY_SECRET_KEY=secret
OPENAI_API_KEY=api-key
TIMEZONE=America/Argentina/Cordoba
```

No cambiar estas variables por cliente salvo que el cliente tenga credenciales propias.

### Comandos utiles

Instalar dependencias:

```bash
cd api-gymhour
npm install
```

Levantar en desarrollo:

```bash
npm run dev
```

Compilar para produccion:

```bash
npm run build
```

El build ejecuta:

- `tsc`
- `prisma generate`
- `npx prisma db push`

Si se despliega en Vercel, el proyecto ya tiene `api-gymhour/vercel.json` y el script:

```bash
npm run vercel-build
```

Ese script genera Prisma, sincroniza el schema con `npx prisma db push` y compila TypeScript.

### Checklist de API

- Crear o seleccionar la base de datos MySQL del cliente.
- Configurar `DATABASE_URL` con la base correcta.
- Configurar `FRONTEND_URL` con el dominio final del frontend.
- Configurar las variables extra necesarias para email, imagenes, auth y asistente.
- Ejecutar el deploy.
- Verificar que la API responda correctamente.
- Verificar que `npx prisma db push` haya sincronizado el schema sin errores.

## 3. Deploy del frontend

El frontend esta en:

```bash
front-gymhour
```

### Configuracion por cliente

Editar:

```bash
front-gymhour/src/setup.js
```

Ese archivo concentra la configuracion del cliente:

```js
const CLIENT_SETUP = {
  apiUrl: process.env.REACT_APP_API_URL || 'http://localhost:3000',

  branding: {
    name: 'GymHour',
    logoAlt: 'Logo del gimnasio',
    logos: {
      login: {
        dark: loginLogoDark,
        light: loginLogoLight,
      },
      sidebar: {
        dark: sidebarLogoDark,
        light: sidebarLogoLight,
      },
    },
    theme: {
      primaryColor: '#DA4632',
      primaryColorHover: '#ee452f',
      backgroundHoverColor: '#da463244',
      loginInputFocusShadowDark: '0 0 0 4px rgba(218, 70, 50, 0.16)',
      loginInputFocusShadowLight: '0 0 0 3px rgba(218, 70, 50, 0.15)',
    },
  },

  payment: {
    accountHolder: 'JUAN PEREZ',
    alias: 'gymhour.alias',
    cbu: '00700238-30004046522411',
    cuil: '20-35752545-5',
    whatsapp: {
      phoneNumber: '5493406423587',
      message: 'Hola! Les comparto el comprobante de pago de este mes:',
    },
  },
};
```

Para cada cliente cambiar:

- `apiUrl`: URL publica de la API del cliente.
- `branding.name`: nombre del gimnasio.
- `branding.logoAlt`: texto alternativo del logo.
- `branding.logos`: logos del cliente.
- `branding.theme`: colores principales del cliente.
- `payment.accountHolder`: titular de cuenta.
- `payment.alias`: alias de pago.
- `payment.cbu`: CBU/CVU.
- `payment.cuil`: CUIL/CUIT.
- `payment.whatsapp.phoneNumber`: WhatsApp con codigo de pais, sin `+`.
- `payment.whatsapp.message`: mensaje prearmado para enviar comprobantes.

Si el proveedor de deploy permite variables de entorno, tambien se puede configurar:

```env
REACT_APP_API_URL=https://api-del-cliente.com
```

Cuando existe `REACT_APP_API_URL`, React usa esa URL en lugar del valor hardcodeado en `setup.js`.

### Logos del cliente

Los logos se importan desde `setup.js`. Para usar logos propios:

1. Agregar los archivos en `front-gymhour/src/assets/client/`.
2. Importarlos en `setup.js`.
3. Asignarlos en `branding.logos.login` y `branding.logos.sidebar`.

Ejemplo:

```js
import clientLogo from './assets/client/logo_cliente.png';

const CLIENT_SETUP = {
  branding: {
    logos: {
      login: {
        dark: clientLogo,
        light: clientLogo,
      },
      sidebar: {
        dark: clientLogo,
        light: clientLogo,
      },
    },
  },
};
```

### Comandos utiles

Instalar dependencias:

```bash
cd front-gymhour
npm install
```

Levantar en desarrollo:

```bash
npm start
```

Compilar para produccion:

```bash
npm run build
```

El build final queda en:

```bash
front-gymhour/build
```

Ese directorio es el que se publica en un hosting de frontend estatico.

### Checklist de frontend

- Editar `front-gymhour/src/setup.js` con la informacion del cliente.
- Verificar que `apiUrl` apunte a la API correcta.
- Agregar logos del cliente si corresponde.
- Ejecutar `npm run build`.
- Publicar el contenido generado en `front-gymhour/build`.
- Probar login, recuperacion de password, cuotas y envio de comprobante por WhatsApp.

## 4. Orden recomendado de deploy

1. Crear la base de datos del cliente.
2. Desplegar la API con `DATABASE_URL` y `FRONTEND_URL`.
3. Verificar que la API este funcionando.
4. Configurar `front-gymhour/src/setup.js` con la URL de la API y los datos del cliente.
5. Desplegar el frontend.
6. Actualizar `FRONTEND_URL` en la API si el dominio final del frontend cambio.
7. Probar el flujo completo desde el dominio publico del cliente.

## 5. Verificaciones finales

Despues de cada deploy, revisar:

- El frontend carga correctamente.
- El login funciona.
- La API recibe requests desde el dominio del frontend.
- Los links de recuperacion de password apuntan al frontend correcto.
- Las cuotas muestran los datos de pago del cliente.
- El boton de WhatsApp abre el numero y mensaje correctos.
- El schema de Prisma quedo sincronizado en la base del cliente con `npx prisma db push`.

## 6. Resumen rapido

Para un cliente nuevo:

1. API: cambiar `FRONTEND_URL`.
2. API: cambiar `DATABASE_URL`.
3. Frontend: cambiar `front-gymhour/src/setup.js`.
4. Deployar API.
5. Deployar frontend.
6. Probar flujo completo.
