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

The script processes images one by one. Estimate about 7.5 minutes per image:

```text
10 images = about 75 minutes
20 images = about 150 minutes
```

Keep the terminal open until it finishes.

## Results

The script writes:

```text
higgsfield-results/results.json
higgsfield-results/results.csv
```

If one image fails, the script continues with the next image.

## Custom prompt

```bash
npm run batch:higgsfield -- --input ./input-images --prompt "Your custom prompt here"
```

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
```
