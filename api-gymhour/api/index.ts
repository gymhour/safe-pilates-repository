// import app from '../src/app.js'
// export default app;
import app from "../dist/app.js";     // tu Express "app"

export default function handler(req, res) {
  return new Promise<void>((resolve, reject) => {
    app(req, res, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}