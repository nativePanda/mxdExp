/**
 * 应用入口：创建 app、装配 Pinia + Router + Element Plus、挂载。
 */

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';

import App from './App.vue';
import router from './router';

import './styles/main.css';
import './styles/element-override.css';

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(ElementPlus);

app.mount('#app');
