import './ui/style.css';
import { Observatory } from './app/Observatory';

const app = new Observatory();
app.start().catch((error: unknown) => app.fail(error));
if (import.meta.hot) import.meta.hot.dispose(() => app.dispose());
