# Image Finder

![Screenshot from the frontend of the application.](https://hosting.photobucket.com/bbcfb0d4-be20-44a0-94dc-65bff8947cf2/3313a319-a4e2-46cc-b960-1ad9f7370c37.png)

Queries Google's Programmable Search Engine for image results, downloads each image file and saves everything to an `output` folder.

## Application Overview

Authenticates with Google's Programmable Search Engine using your API key and search engine ID. The application then runs each query you provide as an image search by requesting as many result pages as you specify. The collected image links are de-duplicated so the same file is not fetched twice.

From there, a number of Python workers downloads each image. Image Finder records each image's dimensions, format, byte size and search rank. Those image files which are blocked by domain, return errors, exceed the size limit or are not image files are recorded as skipped. Everything else is written to a single `output` folder. The project also includes a frontend UI for browsing the images collected from each run.

## Basic Setup Instructions

Below are the required software programs and instructions for installing and using this application on a Linux machine.

### Programs Needed

- [Git](https://git-scm.com/downloads)

- [Python](https://www.python.org/downloads/)

### Setup Steps

1. Install the above programs

2. Open a terminal

3. Clone this repository: `git clone git@github.com:devbret/image-finder.git`

4. Navigate to the repo's directory: `cd image-finder`

5. Create a virtual environment: `python3 -m venv venv`

6. Activate the virtual environment: `source venv/bin/activate`

7. Install the needed dependencies: `pip install -r requirements.txt`

8. Create an `.env` file from the template: `cp .env.template .env`

9. Open `.env` and set values for `API_KEY` and `CX`: `nano .env`

10. Run the program: `python3 app.py`

11. Start a local web server: `python3 -m http.server 8000`

12. Visit the frontend UI in your browser: `http://localhost:8000`

13. When finished, stop the web server: `Ctrl+C`

14. Exit the virtual environment: `deactivate`

## Other Considerations

This section covers additional information about the project, including a summary of the technical skills this repository is intended to demonstrate, as well as how to reach out with questions or collaboration ideas.

### Abilities Demonstrated

This project repo is intended to demonstrate an ability to do the following:

- Query Google's Programmable Search Engine image index and download every result's image file

- Normalize returned URLs and rely on Python workers to fetch each image

- Read each image's dimensions directly from the binary data without any external library

- Record each image's search rank, HTTP status, content hash, format, dimensions, byte size and skip reason

If you have any questions or would like to collaborate, please reach out either on GitHub or via [my website](https://bretbernhoft.com/).
