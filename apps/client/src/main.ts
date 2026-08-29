import './styles/main.css';
import { renderApp } from './App.ts';

const appMount = document.getElementById('app');
if (appMount) {
  appMount.appendChild(renderApp());
}
