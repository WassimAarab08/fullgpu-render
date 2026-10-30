// Runtime JSX propio: evalúa un árbol de elementos React para un fotograma concreto, de forma pura (sin estado entre
// fotogramas, como Remotion cuando renderiza fotogramas sueltos en paralelo), y devuelve nodos anfitrión:
//   { type: "div" | "img" | "video" | "audio" | ..., props, children, media? }  y  { type: "#text", text, children: [] }
// No hay DOM ni reconciliación: los hooks devuelven su valor inicial y los efectos no se ejecutan.
const ELEMENT = Symbol.for("react.transitional.element");
export const Fragment = Symbol.for("react.fragment");
const PROVIDER = Symbol.for("react.provider");
const CONTEXT = Symbol.for("react.context");
const CONSUMER = Symbol.for("react.consumer");
const MEMO = Symbol.for("react.memo");
const FORWARD_REF = Symbol.for("react.forward_ref");

const element = (type, props, key = null) => ({ $$typeof: ELEMENT, type, props, key: key == null ? null : String(key) });

export function createElement(type, config, ...children) {
  const { key, ...props } = config ?? {};
  if (children.length === 1) props.children = children[0];
  else if (children.length > 1) props.children = children;
  return element(type, props, key);
}

/** Lo que genera esbuild con `jsx: "automatic"`: los hijos ya vienen en props. */
export const jsx = (type, props, key) => element(type, { ...props }, key);

export const isValidElement = (v) => typeof v === "object" && v !== null && v.$$typeof === ELEMENT;

export function cloneElement(el, config, ...children) {
  const { key = el.key, ...props } = config ?? {};
  const merged = { ...el.props, ...props };
  if (children.length === 1) merged.children = children[0];
  else if (children.length > 1) merged.children = children;
  return element(el.type, merged, key);
}

export function createContext(defaultValue) {
  const ctx = { $$typeof: CONTEXT, _default: defaultValue };
  ctx.Provider = { $$typeof: PROVIDER, _context: ctx };
  ctx.Consumer = { $$typeof: CONSUMER, _context: ctx };
  return ctx;
}

export const memo = (type) => ({ $$typeof: MEMO, type });
export const forwardRef = (render) => ({ $$typeof: FORWARD_REF, render });

const flatten = (children, out = []) => {
  if (Array.isArray(children)) for (const c of children) flatten(c, out);
  else if (children != null && typeof children !== "boolean") out.push(children);
  return out;
};
export const Children = {
  toArray: (c) => flatten(c),
  map: (c, fn) => flatten(c).map(fn),
  forEach: (c, fn) => flatten(c).forEach(fn),
  count: (c) => flatten(c).length,
  only: (c) => {
    const all = flatten(c);
    if (all.length !== 1 || !isValidElement(all[0])) throw new Error("React.Children.only expected one element");
    return all[0];
  },
};

// Estado del componente que se está renderizando: los hooks lo leen.
let current = null;
let idCounter = 0;
const dispatcher = () => {
  if (!current) throw new Error("Hooks can only be called inside a component that fullgpu-render is rendering");
  return current;
};

export const useContext = (ctx) => {
  const { contexts } = dispatcher();
  return contexts.has(ctx) ? contexts.get(ctx) : ctx._default;
};
export const useState = (init) => (dispatcher(), [typeof init === "function" ? init() : init, () => {}]);
export const useReducer = (_reducer, arg, init) => (dispatcher(), [init ? init(arg) : arg, () => {}]);
export const useRef = (initial = null) => (dispatcher(), { current: initial });
export const useMemo = (fn) => (dispatcher(), fn());
export const useCallback = (fn) => (dispatcher(), fn);
export const useEffect = () => dispatcher() && undefined;
export const useLayoutEffect = useEffect;
export const useInsertionEffect = useEffect;
export const useImperativeHandle = useEffect;
export const useDebugValue = () => {};
export const useId = () => (dispatcher(), `fg${idCounter++}`);
export const useTransition = () => [false, (fn) => fn()];
export const useDeferredValue = (v) => v;
export const useSyncExternalStore = (_subscribe, getSnapshot) => getSnapshot();

function call(fn, args, contexts) {
  const prev = current;
  current = { contexts };
  try {
    return fn(...args);
  } finally {
    current = prev;
  }
}

function evaluate(node, contexts) {
  if (node == null || typeof node === "boolean" || node === "") return [];
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return [{ type: "#text", text: String(node), children: [] }];
  if (Array.isArray(node)) return node.flatMap((n) => evaluate(n, contexts));
  if (!isValidElement(node)) throw new Error(`Objects are not valid as a React child (found: ${Object.prototype.toString.call(node)})`);

  const { type, props } = node;
  if (type === Fragment) return evaluate(props.children, contexts);
  if (typeof type === "string") {
    const { children, __media, ...rest } = props;
    const host = { type, props: rest, children: evaluate(children, contexts) };
    if (__media) host.media = __media;
    return [host];
  }
  if (typeof type === "function") {
    if (type.prototype?.isReactComponent) throw new Error(`Class components are not supported (${type.name}): use a function component`);
    return evaluate(call(type, [props], contexts), contexts);
  }
  switch (type?.$$typeof) {
    case CONTEXT: // React 19: <Context value={...}> es el Provider
    case PROVIDER: {
      const ctx = type.$$typeof === CONTEXT ? type : type._context;
      return evaluate(props.children, new Map(contexts).set(ctx, props.value));
    }
    case CONSUMER: {
      const ctx = type._context;
      return evaluate(props.children(contexts.has(ctx) ? contexts.get(ctx) : ctx._default), contexts);
    }
    case MEMO:
      return evaluate(element(type.type, props, node.key), contexts);
    case FORWARD_REF: {
      const { ref = null, ...rest } = props;
      return evaluate(call(type.render, [rest, ref], contexts), contexts);
    }
  }
  throw new Error(`Unsupported element type: ${String(type?.toString?.() ?? type)}`);
}

/** Línea de tiempo vista por un componente: fotograma local, inicio y fin absolutos del tramo y su duración. */
export const Timeline = createContext(null);
const Collector = createContext(null);
export const CompositionCollector = Collector;

export function renderFrame(el, { frame, id, width, height, fps, durationInFrames, defaultProps = {}, props }) {
  const config = { id, width, height, fps, durationInFrames, defaultProps, props: props ?? defaultProps };
  idCounter = 0;
  const timeline = { frame, start: 0, end: durationInFrames, duration: durationInFrames, config };
  return evaluate(el, new Map([[Timeline, timeline]]));
}

let root = null;
export const setRoot = (component) => {
  root = component;
};

/** Composiciones declaradas con registerRoot(() => <Composition ... />). */
export function getCompositions() {
  if (!root) throw new Error("No root registered: the entry file must call registerRoot()");
  const found = [];
  evaluate(createElement(root), new Map([[Collector, found]]));
  return found;
}
