# Metodologia de versiones y deploys por cliente

Este documento describe una forma simple de manejar versiones del producto y deploys independientes por cliente.

La idea principal es:

- Desarrollar siempre sobre una base comun.
- Crear versiones fijas del producto con tags.
- Tener una branch de deploy por cliente.
- Permitir que cada cliente quede en la version que quiera.

## Conceptos

### `main`

`main` es la rama principal del producto.

Aca se integra el codigo nuevo cuando una funcionalidad o correccion ya esta lista.

`main` no significa que todos los clientes tengan automaticamente esa version.

### Tags

Un tag marca una version fija del producto.

Ejemplos:

```bash
v1.0.0
v1.1.0
v1.2.0
```

Un tag apunta a un commit exacto. Si `main` sigue avanzando, el tag no cambia.

Regla importante: una vez que un tag fue usado para clientes, no se modifica. Si hay que corregir algo, se crea un tag nuevo, por ejemplo `v1.1.1`.

### Branches de deploy

Cada cliente tiene su propia branch de deploy:

```bash
deploy/demo
deploy/cliente-a
deploy/cliente-b
```

Estas branches se usan para que Vercel sepa que version tiene que desplegar para cada cliente.

No se desarrolla codigo directamente en estas branches. Solo se mueven para apuntar a una version.

## Ejemplo de estado

```text
main                ultima version estable del producto
v1.0.0              version fija
v1.1.0              version fija

deploy/demo         apunta a v1.1.0
deploy/cliente-a    apunta a v1.1.0
deploy/cliente-b    apunta a v1.0.0
```

En este ejemplo, Cliente A esta actualizado, pero Cliente B sigue usando una version anterior.

## Crear una nueva version

1. Desarrollar la funcionalidad en una branch normal.

```bash
git checkout main
git pull
git checkout -b feature/nueva-funcionalidad
```

2. Cuando este lista, integrar a `main`.

```bash
git checkout main
git pull
git merge feature/nueva-funcionalidad
git push origin main
```

3. Probar la version en demo o staging.

4. Crear el tag de version.

```bash
git checkout main
git pull
git tag v1.2.0
git push origin v1.2.0
```

Desde ese momento, `v1.2.0` queda disponible para clientes.

## Crear un cliente nuevo

Crear una branch de deploy para ese cliente desde la version elegida:

```bash
git checkout -b deploy/cliente-nuevo v1.2.0
git push origin deploy/cliente-nuevo
```

En Vercel, el proyecto de ese cliente debe estar configurado para desplegar desde:

```text
deploy/cliente-nuevo
```

La configuracion propia del cliente debe ir en variables de entorno de Vercel, no en cambios de codigo.

Ejemplos:

```env
DATABASE_URL=mysql://usuario:password@host:puerto/database
FRONTEND_URL=https://cliente.com
REACT_APP_API_URL=https://api-cliente.com
```

## Actualizar un cliente existente

Si un cliente quiere pasar a una version nueva, mover su branch de deploy al tag elegido.

Ejemplo: actualizar `cliente-a` a `v1.2.0`.

```bash
git fetch origin
git checkout deploy/cliente-a
git reset --hard v1.2.0
git push --force-with-lease origin deploy/cliente-a
```

Vercel detecta el cambio en `deploy/cliente-a` y hace un nuevo deploy.

Los demas clientes no se actualizan.

## Cliente que no quiere actualizar

Si un cliente no quiere actualizar, no se toca su branch de deploy.

Ejemplo:

```text
deploy/cliente-a    v1.2.0
deploy/cliente-b    v1.0.0
```

Cliente B puede seguir usando `v1.0.0` aunque exista `v1.2.0`.

## Rollback

Si una version nueva falla para un cliente, se puede volver a una version anterior.

Ejemplo: volver `cliente-a` a `v1.1.0`.

```bash
git fetch origin
git checkout deploy/cliente-a
git reset --hard v1.1.0
git push --force-with-lease origin deploy/cliente-a
```

## Base de datos

Cada cliente debe tener su propia base de datos.

Cuando se actualiza un cliente, el deploy de ese cliente ejecuta:

```bash
npx prisma db push
```

Eso sincroniza el schema de Prisma con la base de datos de ese cliente.

No se deben ejecutar cambios de base de datos sobre clientes que no se estan actualizando.

Antes de cambios grandes de schema, conviene hacer backup de la base del cliente.

## Reglas simples

- El codigo se desarrolla en `main` o en branches `feature/*`.
- Las versiones se publican con tags.
- Cada cliente tiene una branch `deploy/nombre-cliente`.
- Las branches `deploy/*` no se editan a mano.
- Para actualizar un cliente, se mueve su branch al tag elegido.
- Para no actualizar un cliente, no se toca su branch.
- La configuracion del cliente va en variables de entorno.
- Cada cliente tiene su propia base de datos.

## Tabla sugerida

Conviene mantener una tabla como esta:

```text
Cliente       Branch                 Version
Demo          deploy/demo            v1.2.0
Cliente A     deploy/cliente-a       v1.2.0
Cliente B     deploy/cliente-b       v1.0.0
Cliente C     deploy/cliente-c       v1.1.0
```

Esta tabla ayuda a saber rapidamente que version tiene cada cliente.
