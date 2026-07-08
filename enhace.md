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