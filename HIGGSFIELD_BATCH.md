# Higgsfield Batch Runner

Use this when you do not want to host the web app. The client runs the batch on
their own computer, using their own Higgsfield login and credits.

## One-time setup

```bash
npm install -g @higgsfield/cli
higgsfield auth login
```

Check that the CLI works:

```bash
higgsfield product-photoshoot create --help
```

## Run a batch

1. Put all product images in one folder, for example `input-images`.
2. Run:

```bash
npm run batch:higgsfield -- --input ./input-images --output ./higgsfield-results
```

The script processes each image through three fixed prompts:

1. Arm-Crossed Pose — Muted Green Top
2. Raised Hand Profile — Muted Brown Top
3. Resting Hand Angle — Cream Linen Top

Estimate about 7.5 minutes per generated output:

```text
1 image = 3 outputs = about 22.5 minutes
10 images = 30 outputs = about 225 minutes
20 images = 60 outputs = about 450 minutes
```

Keep the terminal open until it finishes.

## Results

Generated images are downloaded automatically into the output folder. The script
also writes:

```text
higgsfield-results/results.json
higgsfield-results/results.csv
```

If one image fails, the script continues with the next image.

## Useful options

```bash
--output ./folder-name
--mode lifestyle_scene
--aspectRatio 3:4
--count 1
--timeout 10m
```

The default setup is locked for jewelry product photos:

```text
mode: lifestyle_scene
aspect ratio: 3:4
variants per image: 1
fixed prompts per image: 3
```

## Localhost web app output folder

In the browser app, enter a local folder path before running, for example:

```text
/Users/name/Desktop/higgsfield-results
C:\Users\name\Desktop\higgsfield-results
```

The app creates the folder if needed and saves generated images there.
