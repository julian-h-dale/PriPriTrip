fix loading loading for the enhance. 
- right now just navigates back to the form upload screen. looks like an error.  Make loading spinner show instead please. 

I want to change the verbosity of certain descriptions.  I think I would like the day descriptions a little shorter so they are only 2-3 sentences.  I do like the detail so we should move those to individual leg descriptions.  can you update the instructions for that?


I want to build a feature that will verify the trip.  For verification I want to start with two criteria.
1. Make sure there is a 'stay' for every day from the start to end of the trip.
2. if any days come back with completely empty legs. Meaning no plans were found for that day. 

For now we can just create a new /verify endpoint.  Let's see what we can do first without requiring the use of the open ai api.   You will also need to create a new xls file that has a gap in it.  That why I can manually test the verification.

Ask any questions you have.  Give me the plan first and I will confirm before we implement. 


recommendations (reservations, etc)



Ok I want us to narrow the verification of the stays a little more. I want to add an error for the case where a day has a "stayDetails" property but there isn't either a check in or check out date set. 



"Finished"
- sets tracking alerts
- weather forecasts brought in and refreshed every 12 hours
    - generate packing list
- countdown to start

ai features
- packing list
- weather 
- historical guides 
- local guides
- 

Talk with ai
- add points
- add stays
- add travel
- talk through adding points/dates etc
- day summaries

Trip workflow:
We want to build a user friendly workflow to make fixing verification errors easy.

Dependencies
- trip needs to be imported (either import api or ai import)

Backend change
- TripRecord needs to have an added column for "status"
    - the status enum is "draft, finalized, active" 
    - not going to use this right now

UI changes:
page is "trip workflow"
page is a reusable shell for the workflows, which will be step by step "wizards"
The first thing the page needs to do is call the verify for the endpoint. 
    - first iteration we are only going to focus on incomplete travel errors.All other errors are ignored (but will still show on the inspection screen) 
For each workflow step, I want to see a single card on the screen. This card will contain the details of the travel, and show a form for the user to fill the remaining properties out.
Step will have a "next" button on the bottom right of the card.
after the user has fixed all the issues, take them to the trip inspection page.

Ask any questions you have.



AI DOCUMENT IMPORT

We want the user to be able to add travel and stays by uploading documents.  We want a user to be able to send a pdf of a hotel reservation or plane ticket and have the import endpoint add that to the trip.  

dependencies:
- trip needs to already be imported

backend changes:
- we are going to create a new endpoint /trip/ai-document
- endpoint needs to first extract the text from the document.
- New document model. Track created date, user, trip id, last updated, then the body contents.  Also include the filename, we are going to use that to de dupe the files so we don't run the open ai calls repeatedly (save cost).
- send the documents extracted text into the open ai api.  The goal here is to give the open ai api unstructured data, just the document contents, and have the ai return structured data in the form of our models (travel, stay).

Front End Changes:
- new button in the top right of the app bar.  To the left of the existing "stay" icon button.  Make this icon just a document icon.
- clicking that takes you to a new page "document importer".
- Page displays a file upload form
- on file upload, send the file to the backend.
- when a response is recieved, navigate to page that shows a list of the extracted models. page will have a save button, when that is clicked, save any of the found items.

Ask any questions you have. 

Ok, next I want to add another ai import feature.  this one is going to accept records (pdfs) of hotel reservation confirmations, travel confirmation (plane tickets).  Let's start with that and we can expand it.