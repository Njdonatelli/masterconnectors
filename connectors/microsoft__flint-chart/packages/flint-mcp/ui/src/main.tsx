// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { FlintApp } from './FlintApp';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FlintApp />
  </StrictMode>,
);
