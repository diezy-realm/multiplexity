import dotenv from 'dotenv';
import path from 'node:path';

const mode=process.env.NODE_ENV==='production'?'production':'development';
// Keep deployment file precedence while preserving launcher-provided secrets.
dotenv.config({path:[`.env.${mode}.local`,'.env.local',`.env.${mode}`,'.env'].map(file=>path.resolve(file))});
