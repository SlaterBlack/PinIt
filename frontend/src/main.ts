// Copyright Epic Games, Inc. All Rights Reserved.

import { bootstrapApplication } from "@angular/platform-browser";
import { App } from "./app/app";
import { appConfig } from "./app/app.config";

bootstrapApplication(App, appConfig).catch((error: unknown) =>
  console.error(error),
);
