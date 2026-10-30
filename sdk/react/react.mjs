// Sustituto de `react` para el bundle de fullgpu-render: misma API pública que usan los componentes de vídeo.
import {
  createElement, cloneElement, isValidElement, createContext, memo, forwardRef, Fragment, Children,
  useContext, useState, useReducer, useRef, useMemo, useCallback, useEffect, useLayoutEffect, useInsertionEffect,
  useImperativeHandle, useDebugValue, useId, useTransition, useDeferredValue, useSyncExternalStore,
} from "./runtime.mjs";

const api = {
  createElement, cloneElement, isValidElement, createContext, memo, forwardRef, Fragment, Children,
  useContext, useState, useReducer, useRef, useMemo, useCallback, useEffect, useLayoutEffect, useInsertionEffect,
  useImperativeHandle, useDebugValue, useId, useTransition, useDeferredValue, useSyncExternalStore,
};
export {
  createElement, cloneElement, isValidElement, createContext, memo, forwardRef, Fragment, Children,
  useContext, useState, useReducer, useRef, useMemo, useCallback, useEffect, useLayoutEffect, useInsertionEffect,
  useImperativeHandle, useDebugValue, useId, useTransition, useDeferredValue, useSyncExternalStore,
};

export const StrictMode = Fragment;
export const Suspense = ({ children }) => children;
export const createRef = () => ({ current: null });
export const startTransition = (fn) => fn();
export const version = "19.2.0-fullgpu";

const React = { ...api, StrictMode, Suspense, createRef, startTransition, version };
export default React;
