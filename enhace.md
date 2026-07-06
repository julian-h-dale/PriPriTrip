fix loading loading for the enhance. 
- right now just navigates back to the form upload screen. looks like an error.  Make loading spinner show instead please. 

I want to change the verbosity of certain descriptions.  I think I would like the day descriptions a little shorter so they are only 2-3 sentences.  I do like the detail so we should move those to individual leg descriptions.  can you update the instructions for that?


I want to build a feature that will verify the trip.  For verification I want to start with two criteria.
1. Make sure there is a 'stay' for every day from the start to end of the trip.
2. if any days come back with completely empty legs. Meaning no plans were found for that day. 

For now we can just create a new /verify endpoint.  Let's see what we can do first without requiring the use of the open ai api.   You will also need to create a new xls file that has a gap in it.  That why I can manually test the verification.

Ask any questions you have.  Give me the plan first and I will confirm before we implement. 


recommendations (reservations, etc)