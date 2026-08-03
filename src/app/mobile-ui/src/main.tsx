import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { RemoteMobileClient } from "./remote-client";
import { createIndexedDbMobileRemoteStorage } from "./storage";
import "./styles.css";

const client = new RemoteMobileClient(createIndexedDbMobileRemoteStorage());
createRoot(document.getElementById("root")!).render(<StrictMode><App client={client} /></StrictMode>);
