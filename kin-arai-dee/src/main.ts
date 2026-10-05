import '@fontsource/noto-sans-thai/thai-400.css';
import '@fontsource/noto-sans-thai/thai-500.css';
import '@fontsource/noto-sans-thai/thai-600.css';
import '@fontsource/noto-sans-thai/thai-700.css';
import './style.css';
import { loadData } from './data/load';
import { start } from './ui/app';

start(await loadData());
