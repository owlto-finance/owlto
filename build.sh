#!/bin/bash
npm install
npx prisma db pull
npx prisma generate
npx tsc
