Video Demo Link: https://youtu.be/Id7Y1Aai_jI?si=m-gE-EBukV11pKcm
To run on IOS: Download Expo Go, install required dependencies, and run on your iphone

<img width="377" alt="Screenshot 2025-07-06 at 6 29 37 AM" src="https://github.com/user-attachments/assets/632149ed-75fa-484e-afb6-7ab927e7e43e" />
<img width="379" alt="Screenshot 2025-07-06 at 6 30 22 AM" src="https://github.com/user-attachments/assets/8b008ad3-d625-4b60-872f-152f94308661" />

Inspiration
Amid a surge in recent controversial events, protests have become increasingly frequent. However, they often escalate into violence, posing serious safety risks for individuals advocating for their rights and freedoms. Proteful’s goal is to make protesting a safer experience for those standing up for what they believe in.

What it does
Proteful is a mobile app that provides a real-time heatmap that indicates where dangerous protests are located. Through crowd-sourced reports, users can drop a “pin,” which consists of a radius, photo, and note to flag hazards such as police getting illegally violent, fights, outbreaks, etc. The user’s location is continuously tracked. A joystick allows the user to preview different routes, and our algorithm lets you select a destination. It then calculates the shortest path while avoiding all known danger zones. A reset button brings you back to your current GPS location. If you are within 100 meters of a danger zone, the system provides a summary of the nearby threats, a risk index, and personalized tips on whether you should proceed. If you enter a danger zone, you’ll receive an immediate notification alerting you to the risk.

How we built it
We built the app’s core components and user interface using React Native. To create a live, interactive map, we integrated the Google Maps SDK. All hazard pins and their associated data are stored in Firebase, ensuring that this information saves when the app is closed and loads in when the app is rebooted. Next, we enabled location tracking and push notifications, allowing Proteful to deliver real-time alerts and location-based services. Finally, we developed a custom pathfinding algorithm that calculates the safest and shortest route to a destination by avoiding identified danger zones. This was achieved by downloading a global database of map nodes and implementing Dijkstra’s algorithm to optimize navigation around potential hazards.

Challenges we ran into
The biggest challenge we faced was that none of us had prior experience with React Native, and for many team members, it was also their first time working on mobile app development. As a result, we initially struggled to get the project off the ground. We spent the first night watching tutorials and familiarizing ourselves with the platform. Once we understood the basics, we gained momentum and were able to develop rapidly, thanks to our shared background in React.

Accomplishments that we're proud of
The feature we’re most proud of is our custom pathfinding algorithm, built using Dijkstra’s algorithm, which calculates the safest and shortest route to a destination while avoiding known danger zones. This was our first time implementing a concept grounded in theoretical computer science, and seeing it work in a real-world application was a major milestone for us. Prior to this project, most of our experience was in web development and front-end design, so it was both exciting and rewarding to tackle a challenge that demanded more advanced logic, algorithms, and problem-solving.

What we learned
As mentioned earlier, this was our first time working with React Native, and only one team member had minimal experience with mobile app development. This project taught us the value of building on existing knowledge when learning something new. In our case, our background in React made it easier to grasp React Native concepts and workflows, proving that prior experience can serve as a solid foundation for tackling unfamiliar technologies.

What's next for Proteful
Since Proteful is fully functional, addresses a real-world issue, and is ready for use, we plan to launch and deploy it in the near future. Given the many ongoing controversies in today’s world, we believe Proteful has the potential to help many people. As mentioned earlier, its core mission is to make protesting a safer experience for those standing up for their beliefs. The sooner we release it, the sooner we can provide support and protection to those who need it most.
